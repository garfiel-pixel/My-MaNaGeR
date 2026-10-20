/* ============================================================
   mmgr-pdf.js - C5b: the shared TRUE-PDF writer.
   Contract (AUDIT-DIRECTIVE 2026-10-18, C5b + G6):
   input  = the neutral draw list the Gantt export already builds
            ({type:'rect'|'line'|'text'|'poly', ...} in px, y down)
   output = PDF byte array: vector only (never rasterized), landscape
            sheets, the header band (title + table headers) repeated on
            every page, text stays searchable. The Gantt PDF, the
            estimate PDF and the PO PDF (P9) share THIS module so the
            three outputs cannot diverge.
   Page modes:
     'fit' - one page sized to the content (lossless, zero clicks);
     'a4'  - A4 landscape, fit-to-width, vertically paginated with the
             header band repeated on each page;
     'a3'  - same, A3 landscape.
   No dependencies: PDF 1.4, Helvetica core fonts, uncompressed
   streams, byte-accurate xref over latin1 strings.
   ============================================================ */
(function (ns) {
  'use strict';

  const PT_PER_MM = 72 / 25.4;
  const PX_TO_PT = 0.75; // CSS px (96dpi) -> pt (72dpi)
  const SHEETS = {
    a4: [297, 210], // landscape mm
    a3: [420, 297]
  };

  // --- color: '#rrggbb' or 'rgba(r,g,b,a)' -> {r,g,b,a} 0..1 -----------
  function parseColor(c) {
    if (!c || c === 'none') {
      return null;
    }
    let m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) {
      const n = parseInt(m[1], 16);
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
    }
    m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
    if (m) {
      return {
        r: Math.min(255, +m[1]) / 255,
        g: Math.min(255, +m[2]) / 255,
        b: Math.min(255, +m[3]) / 255,
        a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, +m[4]))
      };
    }
    return null;
  }
  const n2 = v => (Math.round(v * 100) / 100).toString();
  const gsName = a => 'a' + String(Math.round(a * 100));

  // --- PDF literal string: escape \ ( ) and control/high bytes --------
  function pdfStr(s) {
    let out = '';
    s = String(s === undefined || s === null ? '' : s);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c > 255) {
        out += '?'; // PDF strings are latin1; never let a glyph break bytes
      } else if (s[i] === '\\' || s[i] === '(' || s[i] === ')') {
        out += '\\' + s[i];
      } else if (c < 32 || c > 126) {
        out += '\\' + c.toString(8).padStart(3, '0');
      } else {
        out += s[i];
      }
    }
    return out;
  }

  // Rough Helvetica advance for right-aligned text (digits are 0.556em).
  function textWidth(str, size) {
    const digits = /^[\d.\-/: ]+$/.test(str);
    return String(str).length * size * (digits ? 0.556 : 0.52);
  }

  // vertical extent of a prim (logical px, y down)
  function primY0(p) {
    if (p.type === 'rect') return p.y;
    if (p.type === 'text') return p.y - p.size;
    if (p.type === 'line') return Math.min(p.y1, p.y2);
    return Math.min.apply(
      null,
      p.pts.map(pt => pt[1])
    );
  }
  function primY1(p) {
    if (p.type === 'rect') return p.y + p.h;
    if (p.type === 'text') return p.y + p.size * 0.3;
    if (p.type === 'line') return Math.max(p.y1, p.y2);
    return Math.max.apply(
      null,
      p.pts.map(pt => pt[1])
    );
  }

  // ---------------------------------------------------------------
  // build(prims, opts) -> {bytes: Uint8Array, pages: number, mode}
  // opts: { page:'fit'|'a4'|'a3', W, H, hdrPx, marginMm? }
  // ---------------------------------------------------------------
  function build(prims, opts) {
    const W = opts.W,
      H = opts.H;
    const hdrPx = opts.hdrPx || 0;
    const mode = opts.page === 'a4' || opts.page === 'a3' ? opts.page : 'fit';

    // ---- page plan ----------------------------------------------------
    let pages;
    if (mode === 'fit') {
      // One page sized to the content; every prim draws as-is, no margin.
      pages = [
        {
          w: W * PX_TO_PT,
          h: H * PX_TO_PT,
          s: PX_TO_PT,
          margin: 0,
          clip: null,
          prims: prims,
          header: null
        }
      ];
    } else {
      const margin = (opts.marginMm === undefined ? 10 : opts.marginMm) * PT_PER_MM;
      const sheet = SHEETS[mode];
      const pw = sheet[0] * PT_PER_MM,
        ph = sheet[1] * PT_PER_MM;
      const s = (pw - 2 * margin) / W;
      const hdrPt = hdrPx * s;
      const winPx = Math.max(40, (ph - 2 * margin - hdrPt) / s); // body window, px
      const isHeader = p => {
        if (p.type === 'text') return p.y < hdrPx;
        if (p.type === 'rect') return p.y + p.h <= hdrPx;
        if (p.type === 'line') return p.y1 < hdrPx && p.y2 < hdrPx;
        if (p.type === 'poly') return p.pts.every(pt => pt[1] < hdrPx);
        return false;
      };
      const header = prims.filter(isHeader);
      const body = prims.filter(p => !isHeader(p));
      pages = [];
      for (let start = hdrPx; start < H; start += winPx) {
        const end = Math.min(H, start + winPx);
        pages.push({
          w: pw,
          h: ph,
          s: s,
          margin: margin,
          clip: [0, start, W, end - start],
          header: header,
          // keep prims whose vertical extent crosses the window (grid
          // lines, weekend columns span the whole chart); the PDF clip
          // path trims what shows.
          prims: body.filter(p => primY0(p) < end && primY1(p) > start)
        });
      }
    }

    // ---- one page's content stream ------------------------------------
    const allAlphas = {};
    function contentFor(pg) {
      const s = pg.s,
        m = pg.margin;
      const out = [];
      // Transforms. Body sits BELOW the repeated header band: the header
      // occupies logical y in [0, hdrPx) drawn at the page top, the body
      // window starts under it.
      const tx = x => m + (x - (pg.clip ? pg.clip[0] : 0)) * s;
      const tyBody = y => pg.h - m - hdrPx * s - (y - (pg.clip ? pg.clip[1] : 0)) * s;
      const tyHeader = y => pg.h - m - y * s;
      const fillOps = c => {
        const cc = parseColor(c);
        if (!cc) return null;
        if (cc.a < 1) allAlphas[cc.a] = true;
        return (
          n2(cc.r) +
          ' ' +
          n2(cc.g) +
          ' ' +
          n2(cc.b) +
          ' rg ' +
          (cc.a < 1 ? '/GS' + gsName(cc.a) + ' gs ' : '')
        );
      };
      const strokeOps = (c, lw, dash) => {
        const cc = parseColor(c);
        if (!cc) return null;
        if (cc.a < 1) allAlphas[cc.a] = true;
        let o =
          n2(cc.r) + ' ' + n2(cc.g) + ' ' + n2(cc.b) + ' RG ' + n2(Math.max(0.3, lw * s)) + ' w ';
        if (dash && dash.length) o += '[' + dash.map(d => n2(d * s)).join(' ') + '] 0 d ';
        if (cc.a < 1) o += '/GS' + gsName(cc.a) + ' gs ';
        return o;
      };
      const drawAll = (list, ty) => {
        list.forEach(p => {
          if (p.type === 'rect') {
            const f = p.fill ? fillOps(p.fill) : '';
            const st = p.stroke ? strokeOps(p.stroke, p.lw || 1) : '';
            if (!f && !st) return;
            out.push(
              'q ' +
                (f || '') +
                (st || '') +
                n2(tx(p.x)) +
                ' ' +
                n2(ty(p.y + p.h)) +
                ' ' +
                n2(p.w * s) +
                ' ' +
                n2(p.h * s) +
                ' re ' +
                (f && st ? 'B' : f ? 'f' : 'S') +
                ' Q '
            );
          } else if (p.type === 'line') {
            const st = strokeOps(p.stroke, p.lw || 1, p.dash);
            if (!st) return;
            out.push(
              'q ' +
                st +
                n2(tx(p.x1)) +
                ' ' +
                n2(ty(p.y1)) +
                ' m ' +
                n2(tx(p.x2)) +
                ' ' +
                n2(ty(p.y2)) +
                ' l S Q '
            );
          } else if (p.type === 'poly') {
            const f = p.fill ? fillOps(p.fill) : '';
            const st = p.stroke ? strokeOps(p.stroke, p.lw || 1) : '';
            if (!f && !st) return;
            let path = '';
            p.pts.forEach((pt, i) => {
              path += n2(tx(pt[0])) + ' ' + n2(ty(pt[1])) + (i === 0 ? ' m ' : ' l ');
            });
            out.push(
              'q ' +
                (f || '') +
                (st || '') +
                path +
                (p.close ? 'h ' : '') +
                (f && st ? 'B' : f ? 'f' : 'S') +
                ' Q '
            );
          } else if (p.type === 'text') {
            const cc = parseColor(p.fill);
            if (!cc) return;
            if (cc.a < 1) allAlphas[cc.a] = true;
            const size = Math.max(4, p.size * s);
            let x = tx(p.x);
            if (p.align === 'right') x -= textWidth(p.str, size);
            out.push(
              'q ' +
                n2(cc.r) +
                ' ' +
                n2(cc.g) +
                ' ' +
                n2(cc.b) +
                ' rg ' +
                (cc.a < 1 ? '/GS' + gsName(cc.a) + ' gs ' : '') +
                'BT /' +
                ((p.weight || 400) >= 600 ? 'F2' : 'F1') +
                ' ' +
                n2(size) +
                ' Tf ' +
                n2(x) +
                ' ' +
                n2(ty(p.y)) +
                ' Td (' +
                pdfStr(p.str) +
                ') Tj ET Q '
            );
          }
        });
      };
      if (pg.clip) {
        // body window, clipped, sitting under the header band
        const c = pg.clip;
        out.push(
          'q ' +
            n2(tx(c[0])) +
            ' ' +
            n2(tyBody(c[1] + c[3])) +
            ' ' +
            n2(c[2] * s) +
            ' ' +
            n2(c[3] * s) +
            ' re W n '
        );
        drawAll(pg.prims, tyBody);
        out.push('Q ');
        // repeated header band: title block + table column headers
        if (pg.header && pg.header.length) {
          drawAll(pg.header, tyHeader);
        }
      } else {
        drawAll(pg.prims, tyHeader);
      }
      return out.join('');
    }

    // ---- assemble objects --------------------------------------------
    const streams = pages.map(contentFor);
    const gsEntries = Object.keys(allAlphas)
      .map(a => '/GS' + gsName(+a) + ' << /ca ' + n2(+a) + ' /CA ' + n2(+a) + ' >>')
      .join(' ');

    const objs = []; // 1-based: objs[i-1] is the body of (i) 0 obj
    const kids = [];
    const pageObjNums = [];
    let next = 5; // 1 catalog, 2 pages, 3 F1, 4 F2, then (page, content) pairs
    pages.forEach(() => {
      pageObjNums.push(next);
      kids.push(next + ' 0 R');
      next += 2;
    });
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages.length + ' >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
    pages.forEach((pg, i) => {
      const res =
        '<< /ExtGState << ' +
        (gsEntries || '/GSa100 << /ca 1 /CA 1 >> ') +
        '>> /Font << /F1 3 0 R /F2 4 0 R >> >>';
      objs.push(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
          n2(pg.w) +
          ' ' +
          n2(pg.h) +
          '] /Resources ' +
          res +
          ' /Contents ' +
          (pageObjNums[i] + 1) +
          ' 0 R >>'
      );
      objs.push('<< /Length ' + streams[i].length + ' >>\nstream\n' + streams[i] + '\nendstream');
    });

    // xref byte offsets over latin1 strings (every char <= 255 => 1 byte)
    let outStr = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets = [0];
    objs.forEach((body, i) => {
      offsets.push(outStr.length);
      outStr += i + 1 + ' 0 obj\n' + body + '\nendobj\n';
    });
    const xrefAt = outStr.length;
    outStr += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= objs.length; i++) {
      outStr += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    outStr +=
      'trailer\n<< /Size ' +
      (objs.length + 1) +
      ' /Root 1 0 R >>\nstartxref\n' +
      xrefAt +
      '\n%%EOF\n';

    const bytes = new Uint8Array(outStr.length);
    for (let i = 0; i < outStr.length; i++) {
      bytes[i] = outStr.charCodeAt(i) & 0xff;
    }
    return { bytes: bytes, pages: pages.length, mode: mode };
  }

  ns.Pdf = {
    build: build,
    SHEETS: SHEETS
  };
})((window.MMGR = window.MMGR || {}));
