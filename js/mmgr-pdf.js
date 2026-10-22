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

  // S-6.3 (AUDIT-DIRECTIVE 2026-10-18): Helvetica advance widths, per glyph,
  // in 1/1000 em - the same table the AFM ships. The old estimator was
  // `length * size * 0.52` (0.556 for digits), which UNDER-measured anything
  // with capitals, 'm' or 'w' (0.667-0.944 em each). Right-aligned text is
  // positioned by subtracting this width from its anchor, so an undershoot put
  // the cell's text past the printable box and the PDF clip path sliced the
  // last glyphs off - the "right column is clipped at some sizes" defect.
  const HELV = {
    ' ': 278,
    '!': 278,
    '"': 355,
    '#': 556,
    $: 556,
    '%': 889,
    '&': 667,
    "'": 191,
    '(': 333,
    ')': 333,
    '*': 389,
    '+': 584,
    ',': 278,
    '-': 333,
    '.': 278,
    '/': 278,
    ':': 278,
    ';': 278,
    '<': 584,
    '=': 584,
    '>': 584,
    '?': 556,
    '@': 1015,
    A: 667,
    B: 667,
    C: 722,
    D: 722,
    E: 667,
    F: 611,
    G: 778,
    H: 722,
    I: 278,
    J: 500,
    K: 667,
    L: 556,
    M: 833,
    N: 722,
    O: 778,
    P: 667,
    Q: 778,
    R: 722,
    S: 667,
    T: 611,
    U: 722,
    V: 667,
    W: 944,
    X: 667,
    Y: 667,
    Z: 611,
    '[': 278,
    '\\': 278,
    ']': 278,
    '^': 469,
    _: 556,
    '`': 333,
    a: 556,
    b: 556,
    c: 500,
    d: 556,
    e: 556,
    f: 278,
    g: 556,
    h: 556,
    i: 222,
    j: 222,
    k: 500,
    l: 222,
    m: 833,
    n: 556,
    o: 556,
    p: 556,
    q: 556,
    r: 333,
    s: 500,
    t: 278,
    u: 556,
    v: 500,
    w: 722,
    x: 500,
    y: 500,
    z: 500,
    '{': 334,
    '|': 260,
    '}': 334,
    '~': 584
  };
  // Bold is ~5% wider than regular Helvetica and the sprite only carries the
  // two core faces, so a bold run is measured with a safety factor. An
  // OVER-estimate is harmless (the text ends a hair inside its cell); an
  // under-estimate is what clips.
  const BOLD_FACTOR = 1.08;
  const DEFAULT_GLYPH = 556; // anything unknown: the digit advance
  function textWidth(str, size, weight) {
    const s = String(str === undefined || str === null ? '' : str);
    let em = 0;
    for (let i = 0; i < s.length; i++) {
      const w = HELV[s[i]];
      em += w === undefined ? DEFAULT_GLYPH : w;
    }
    em = (em / 1000) * size;
    return weight >= 600 ? em * BOLD_FACTOR : em;
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

  // S-6.3: ONE printable-box measurement for every PDF surface. The print
  // sheet in css/mmgr.css carries the same numbers in its own @page block and
  // tools/verify-print-dom.cjs fails if the two ever drift, so the vector
  // export and the browser's print-to-PDF cannot disagree about where the
  // paper edge (and the browser's own header/footer strip) begins.
  //   marginMm     - ink never closer than this to any paper edge
  //   headerGapPx  - breathing room between the repeated header band and the
  //                  first body row (the band used to abut it: the first row
  //                  read as if it sat UNDER the header chrome)
  const PRINT_BOX = { marginMm: 12, headerGapPx: 10 };

  // ---------------------------------------------------------------
  // build(prims, opts) -> {bytes, pages, mode, layout}
  // opts: { page:'fit'|'a4'|'a3', W, H, hdrPx, marginMm? , headerGapPx? }
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
      const margin = (opts.marginMm === undefined ? PRINT_BOX.marginMm : opts.marginMm) * PT_PER_MM;
      const sheet = SHEETS[mode];
      const pw = sheet[0] * PT_PER_MM,
        ph = sheet[1] * PT_PER_MM;
      const s = (pw - 2 * margin) / W;
      const hdrPt = hdrPx * s;
      // S-6.3: the body window starts BELOW the repeated band plus a gap, so
      // no row can ever sit under the header chrome.
      const gapPx = Math.max(
        0,
        opts.headerGapPx === undefined ? PRINT_BOX.headerGapPx : opts.headerGapPx
      );
      const bodyTop = hdrPx + gapPx;
      const winPx = Math.max(40, (ph - 2 * margin - hdrPt - gapPx * s) / s); // body window, px
      const isHeader = p => {
        if (p.type === 'text') return p.y < hdrPx;
        if (p.type === 'rect') return p.y + p.h <= hdrPx;
        if (p.type === 'line') return p.y1 < hdrPx && p.y2 < hdrPx;
        if (p.type === 'poly') return p.pts.every(pt => pt[1] < hdrPx);
        return false;
      };
      const header = prims.filter(isHeader);
      const body = prims.filter(p => !isHeader(p));
      // S-6.3: break the pages BETWEEN text lines, never through one. A hard
      // `start + winPx` cut sliced whichever row straddled it - the glyphs of
      // that row were half on one sheet and half clipped away. Bands are the
      // merged vertical extents of the text prims; a break that lands inside a
      // band is moved to its top (or past it when the page is already nearly
      // full), so every line of text is whole on exactly one page.
      const bands = [];
      body
        .filter(p => p.type === 'text')
        .map(p => [primY0(p), primY1(p)])
        .sort((a, b) => a[0] - b[0])
        .forEach(r => {
          const last = bands[bands.length - 1];
          if (last && r[0] <= last[1] + 1) {
            last[1] = Math.max(last[1], r[1]);
          } else {
            bands.push([r[0], r[1]]);
          }
        });
      const breakAt = end => {
        const st = bands.find(b => b[0] < end && b[1] > end && b[1] - b[0] <= winPx * 0.9);
        if (!st) return end;
        // Either pull the break up to the top of the straddling line (when the
        // sheet keeps at least 60% of its body) or carry the line to the next
        // sheet. Both keep the line whole; neither loses a row.
        return end - st[0] >= winPx * 0.6 ? st[0] : Math.min(H, st[1]);
      };
      pages = [];
      for (let start = bodyTop; start < H;) {
        // A break can only ever move UP from the natural cut, and never back
        // past the window it is paginating (a pathological draw list must not
        // be able to produce an empty page or a loop).
        let end = start + winPx >= H ? H : breakAt(start + winPx);
        if (!(end > start)) {
          end = Math.min(H, start + winPx);
        }
        pages.push({
          w: pw,
          h: ph,
          s: s,
          margin: margin,
          clip: [0, start, W, Math.max(1, end - start)],
          header: header,
          // keep prims whose vertical extent crosses the window (grid
          // lines, weekend columns span the whole chart); the PDF clip
          // path trims what shows.
          prims: body.filter(p => primY0(p) < end && primY1(p) > start)
        });
        start = end;
      }
      if (!pages.length) {
        pages.push({
          w: pw,
          h: ph,
          s: s,
          margin: margin,
          clip: [0, bodyTop, W, Math.max(1, H - bodyTop)],
          header: header,
          prims: body
        });
      }
    }

    // ---- one page's content stream ------------------------------------
    const allAlphas = {};
    function contentFor(pg) {
      const s = pg.s,
        m = pg.margin;
      // S-6.3: the printable box of THIS sheet, in points. Text is clamped into
      // it (and the measurement is recorded) so no glyph can be trimmed by the
      // clip path: the right column used to lose its last characters when the
      // rough width estimate undershot.
      const boxX0 = m,
        boxX1 = pg.w - m,
        boxY0 = m,
        boxY1 = pg.h - m;
      pg.drawn = pg.drawn || [];
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
      const drawAll = (list, ty, band) => {
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
            const bold = (p.weight || 400) >= 600;
            const w = textWidth(p.str, size, p.weight);
            let x = tx(p.x);
            if (p.align === 'right') x -= w;
            else if (p.align === 'center') x -= w / 2;
            // Clamp into the printable box: a cell's text is never allowed to
            // run past the paper edge where the clip path would cut it.
            if (w <= boxX1 - boxX0) {
              x = Math.min(Math.max(x, boxX0), boxX1 - w);
            } else {
              x = boxX0;
            }
            let y = ty(p.y);
            const ascent = size * 0.72,
              descent = size * 0.24;
            if (y - ascent < boxY0) y = boxY0 + ascent;
            if (y + descent > boxY1) y = boxY1 - descent;
            pg.drawn.push({
              str: String(p.str),
              x: x,
              y: y,
              w: w,
              size: size,
              band: band || (pg.clip ? 'body' : 'page')
            });
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
                (bold ? 'F2' : 'F1') +
                ' ' +
                n2(size) +
                ' Tf ' +
                n2(x) +
                ' ' +
                n2(y) +
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
        drawAll(pg.prims, tyBody, 'body');
        out.push('Q ');
        // repeated header band: title block + table column headers
        if (pg.header && pg.header.length) {
          drawAll(pg.header, tyHeader, 'header');
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
    // S-6.3 gate hook: the geometry the writer actually drew, in points. The
    // harness reads THIS (never an independent re-measure) and fails when any
    // text box leaves the printable box on any sheet.
    const layout = pages.map(pg => ({
      w: pg.w,
      h: pg.h,
      box: { x0: pg.margin, y0: pg.margin, x1: pg.w - pg.margin, y1: pg.h - pg.margin },
      clip: pg.clip,
      texts: pg.drawn || []
    }));

    return { bytes: bytes, pages: pages.length, mode: mode, layout: layout, box: PRINT_BOX };
  }

  ns.Pdf = {
    build: build,
    SHEETS: SHEETS,
    PRINT_BOX: PRINT_BOX,
    textWidth: textWidth
  };
})((window.MMGR = window.MMGR || {}));
