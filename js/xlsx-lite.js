/* ============================================================
   My MaNaGeR - xlsx-lite
   ============================================================
   A spreadsheet writer with NO dependencies. The page's CSP is
   script-src 'self', so SheetJS can never be loaded from a CDN;
   an .xlsx is a ZIP of XML parts, and a "stored" (uncompressed)
   ZIP needs nothing but CRC-32. That is all this file is.

   Contract (used by calculator-page.js, tested by
   tools/verify-export.cjs):

     MMGR.XlsxLite.build([
       { name: 'Summary', rows: [['label', 1234.5]], widths: [26, 18], money: [1] }
     ]) -> Uint8Array

   rows: array of rows; each cell is a string, a number, or
   null/undefined for an empty cell. A number is written as a
   NUMBER cell (so a spreadsheet can sum it), a string as an
   inline string. `bold: [rowIndex]` makes a row a header row;
   `money: [colIndex]` formats that column as #,##0.00.
   ============================================================ */
(function () {
  'use strict';

  var ns = (window.MMGR = window.MMGR || {});

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8(str) {
    if (window.TextEncoder) {
      return new TextEncoder().encode(str);
    }
    // Very old browsers only; every supported target has TextEncoder.
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  // ---- stored ZIP ---------------------------------------------------------
  function pushU16(arr, v) {
    arr.push(v & 0xff, (v >>> 8) & 0xff);
  }
  function pushU32(arr, v) {
    arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }

  function zip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    files.forEach(function (f) {
      var nameBytes = utf8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var local = [];
      pushU32(local, 0x04034b50);
      pushU16(local, 20); // version needed
      pushU16(local, 0); // flags
      pushU16(local, 0); // method: stored
      pushU16(local, 0); // time
      pushU16(local, 0); // date
      pushU32(local, crc);
      pushU32(local, data.length);
      pushU32(local, data.length);
      pushU16(local, nameBytes.length);
      pushU16(local, 0);
      chunks.push(new Uint8Array(local), nameBytes, data);

      var dir = [];
      pushU32(dir, 0x02014b50);
      pushU16(dir, 20); // version made by
      pushU16(dir, 20); // version needed
      pushU16(dir, 0);
      pushU16(dir, 0);
      pushU16(dir, 0);
      pushU16(dir, 0);
      pushU32(dir, crc);
      pushU32(dir, data.length);
      pushU32(dir, data.length);
      pushU16(dir, nameBytes.length);
      pushU16(dir, 0);
      pushU16(dir, 0);
      pushU16(dir, 0);
      pushU16(dir, 0);
      pushU32(dir, 0); // external attrs
      pushU32(dir, offset);
      central.push(new Uint8Array(dir), nameBytes);

      offset += local.length + nameBytes.length + data.length;
    });

    var centralSize = central.reduce(function (n, u) {
      return n + u.length;
    }, 0);
    var end = [];
    pushU32(end, 0x06054b50);
    pushU16(end, 0);
    pushU16(end, 0);
    pushU16(end, files.length);
    pushU16(end, files.length);
    pushU32(end, centralSize);
    pushU32(end, offset);
    pushU16(end, 0);

    return concat(chunks.concat(central, [new Uint8Array(end)]));
  }

  function concat(list) {
    var total = list.reduce(function (n, u) {
      return n + u.length;
    }, 0);
    var out = new Uint8Array(total);
    var at = 0;
    list.forEach(function (u) {
      out.set(u, at);
      at += u.length;
    });
    return out;
  }

  // ---- XML ----------------------------------------------------------------
  function xml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colName(i) {
    var s = '';
    i = i + 1;
    while (i > 0) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  // style indexes in styles.xml: 1 = bold, 2 = money, 3 = bold + money
  function cell(ref, value, money, bold) {
    if (value === null || value === undefined || value === '') {
      return '';
    }
    var style = bold ? (money ? 3 : 1) : money ? 2 : 0;
    var sAttr = style ? ' s="' + style + '"' : '';
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '"' + sAttr + '><v>' + value + '</v></c>';
    }
    return (
      '<c r="' +
      ref +
      '"' +
      sAttr +
      ' t="inlineStr"><is><t xml:space="preserve">' +
      xml(value) +
      '</t></is></c>'
    );
  }

  function sheetXml(sheet) {
    var moneyCols = sheet.money || [];
    var boldRows = sheet.bold || [];
    var maxCols = 1;
    (sheet.rows || []).forEach(function (row) {
      if (row.length > maxCols) {
        maxCols = row.length;
      }
    });
    var cols = '';
    var widths = sheet.widths || [];
    for (var c = 0; c < maxCols; c++) {
      var w = widths[c] || 18;
      cols +=
        '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>';
    }
    var body = '';
    (sheet.rows || []).forEach(function (row, r) {
      var cells = '';
      row.forEach(function (value, ci) {
        cells += cell(
          colName(ci) + (r + 1),
          value,
          moneyCols.indexOf(ci) > -1,
          boldRows.indexOf(r) > -1
        );
      });
      body += '<row r="' + (r + 1) + '">' + cells + '</row>';
    });
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
      '<cols>' +
      cols +
      '</cols>' +
      '<sheetData>' +
      body +
      '</sheetData></worksheet>'
    );
  }

  var STYLES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(sheets) {
    var list = Array.isArray(sheets) ? sheets : [];
    if (!list.length) {
      list = [{ name: 'Sheet1', rows: [[]] }];
    }
    // Excel sheet names: <= 31 chars, no []:*?/\
    var names = list.map(function (s, i) {
      var n = String(s.name || 'Sheet' + (i + 1)).replace(/[[\]:*?/\\]/g, ' ');
      return n.slice(0, 31) || 'Sheet' + (i + 1);
    });

    var files = [];
    var overrides = '';
    var sheetEntries = '';
    list.forEach(function (sheet, i) {
      var part = 'xl/worksheets/sheet' + (i + 1) + '.xml';
      files.push({ name: part, data: utf8(sheetXml(sheet)) });
      overrides +=
        '<Override PartName="/' +
        part +
        '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      sheetEntries +=
        '<sheet name="' + xml(names[i]) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    });

    files.push({
      name: '[Content_Types].xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          overrides +
          '</Types>'
      )
    });
    files.push({
      name: '_rels/.rels',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'
      )
    });
    files.push({
      name: 'xl/workbook.xml',
      data: utf8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
          '<sheets>' +
          sheetEntries +
          '</sheets></workbook>'
      )
    });
    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    list.forEach(function (sheet, i) {
      rels +=
        '<Relationship Id="rId' +
        (i + 1) +
        '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
        (i + 1) +
        '.xml"/>';
    });
    rels +=
      '<Relationship Id="rId' +
      (list.length + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: utf8(rels) });
    files.push({ name: 'xl/styles.xml', data: utf8(STYLES) });

    return zip(files);
  }

  // ============================================================
  // P3 (procurement import, 2026-10-20): a READER to match the writer.
  // Real .xlsx files from Excel/Sheets are DEFLATE-compressed zips, so
  // this is a complete RFC-1951 inflate (stored + fixed + dynamic
  // Huffman), a central-directory walker, and a sheet1->rows parse.
  // No dependencies; tools/qa-procurement.cjs validates the inflate
  // against zlib's own deflate output byte-for-byte.
  // ============================================================
  function inflateRaw(data, expectedSize) {
    var pos = 0,
      bitBuf = 0,
      bitCnt = 0;
    function bits(n) {
      while (bitCnt < n) {
        bitBuf |= data[pos++] << bitCnt;
        bitCnt += 8;
      }
      var v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    function buildTree(lengths) {
      var max = 0,
        i;
      for (i = 0; i < lengths.length; i++) {
        if (lengths[i] > max) max = lengths[i];
      }
      var blCount = [];
      for (i = 0; i <= max; i++) blCount[i] = 0;
      for (i = 0; i < lengths.length; i++) if (lengths[i]) blCount[lengths[i]]++;
      var nextCode = [];
      for (i = 0; i <= max; i++) nextCode[i] = 0;
      var code = 0;
      for (var b = 1; b <= max; b++) {
        code = (code + blCount[b - 1]) << 1;
        nextCode[b] = code;
      }
      var map = {};
      for (i = 0; i < lengths.length; i++) {
        var l = lengths[i];
        if (l) {
          map[(l << 16) | nextCode[l]] = i;
          nextCode[l]++;
        }
      }
      return { map: map, max: max };
    }
    function decode(tree) {
      var code = 0;
      for (var len = 1; len <= tree.max; len++) {
        code = (code << 1) | bits(1);
        var sym = tree.map[(len << 16) | code];
        if (sym !== undefined) return sym;
      }
      throw new Error('Corrupt zip (bad Huffman code)');
    }
    var LBASE = [
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
      163, 195, 227, 258
    ];
    var LEXT = [
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0
    ];
    var DBASE = [
      1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
      2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577
    ];
    var DEXT = [
      0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
      13
    ];
    var fixedLit = null,
      fixedDist = null;
    function fixedTrees() {
      if (fixedLit) return;
      var l = [],
        i;
      for (i = 0; i < 144; i++) l[i] = 8;
      for (; i < 256; i++) l[i] = 9;
      for (; i < 280; i++) l[i] = 7;
      for (; i < 288; i++) l[i] = 8;
      fixedLit = buildTree(l);
      var d = [];
      for (i = 0; i < 30; i++) d[i] = 5;
      fixedDist = buildTree(d);
    }
    var out = new Uint8Array(expectedSize || 4096);
    var outLen = 0;
    function emit(b) {
      if (outLen >= out.length) {
        var n = new Uint8Array(out.length * 2);
        n.set(out);
        out = n;
      }
      out[outLen++] = b;
    }
    var last = 0;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        bitBuf = 0;
        bitCnt = 0;
        var slen = data[pos] | (data[pos + 1] << 8);
        pos += 4;
        for (var i2 = 0; i2 < slen; i2++) emit(data[pos++]);
      } else {
        var lit, dist;
        if (type === 1) {
          fixedTrees();
          lit = fixedLit;
          dist = fixedDist;
        } else if (type === 2) {
          var hlit = bits(5) + 257,
            hdist = bits(5) + 1,
            hclen = bits(4) + 4;
          var order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
          var clen = [];
          for (var c = 0; c < 19; c++) clen[c] = 0;
          for (var c2 = 0; c2 < hclen; c2++) clen[order[c2]] = bits(3);
          var ct = buildTree(clen);
          var lens = [];
          while (lens.length < hlit + hdist) {
            var sym = decode(ct);
            if (sym < 16) lens.push(sym);
            else if (sym === 16) {
              var prev = lens[lens.length - 1],
                r = bits(2) + 3;
              while (r--) lens.push(prev);
            } else if (sym === 17) {
              var r2 = bits(3) + 3;
              while (r2--) lens.push(0);
            } else {
              var r3 = bits(7) + 11;
              while (r3--) lens.push(0);
            }
          }
          lit = buildTree(lens.slice(0, hlit));
          dist = buildTree(lens.slice(hlit));
        } else {
          throw new Error('Corrupt zip (bad block type)');
        }
        for (;;) {
          var s = decode(lit);
          if (s === 256) break;
          if (s < 256) emit(s);
          else {
            s -= 257;
            var length = LBASE[s] + bits(LEXT[s]);
            var ds = decode(dist);
            var d0 = DBASE[ds] + bits(DEXT[ds]);
            var start = outLen - d0;
            for (var k = 0; k < length; k++) emit(out[start + k]);
          }
        }
      }
    } while (!last);
    return out.slice(0, outLen);
  }

  function zipEntries(bytes) {
    function u16(o) {
      return bytes[o] | (bytes[o + 1] << 8);
    }
    function u32(o) {
      return (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
    }
    var eocd = -1;
    for (var i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x05 &&
        bytes[i + 3] === 0x06
      ) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('That file is not a spreadsheet (zip) file.');
    var count = u16(eocd + 10);
    var p = u32(eocd + 16);
    var out = [];
    for (var n = 0; n < count; n++) {
      if (u32(p) !== 0x02014b50) throw new Error('Corrupt spreadsheet (bad zip directory).');
      var method = u16(p + 10);
      var compSize = u32(p + 20);
      var nameLen = u16(p + 28);
      var extraLen = u16(p + 30);
      var commentLen = u16(p + 32);
      var localOff = u32(p + 42);
      var name = '';
      for (var j = 0; j < nameLen; j++) name += String.fromCharCode(bytes[p + 46 + j]);
      var dataOff = localOff + 30 + u16(localOff + 26) + u16(localOff + 28);
      var raw = bytes.subarray(dataOff, dataOff + compSize);
      var data;
      if (method === 0) data = raw;
      else if (method === 8) data = inflateRaw(raw, compSize * 6 + 1024);
      else throw new Error('Unsupported compression in that spreadsheet.');
      out.push({ name: name, data: data });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  function decodeUtf8(bytes) {
    if (window.TextDecoder) {
      return new window.TextDecoder('utf-8').decode(bytes);
    }
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function xmlUnescape(s) {
    return String(s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, d) {
        return String.fromCharCode(parseInt(d, 10));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) {
        return String.fromCharCode(parseInt(h, 16));
      })
      .replace(/&amp;/g, '&');
  }

  // read(bytes) -> [{ name, rows }] - one entry per worksheet, rows of
  // cell values (numbers as numbers, shared strings resolved). Covers
  // what Excel/Sheets actually emit: sharedStrings, inline strings,
  // sparse refs (B3, D7 - gaps stay empty).
  function read(bytes) {
    var entries = zipEntries(bytes);
    var byName = {};
    entries.forEach(function (e) {
      byName[e.name] = e;
    });
    var shared = [];
    if (byName['xl/sharedStrings.xml']) {
      var ss = decodeUtf8(byName['xl/sharedStrings.xml'].data);
      shared = ss
        .split('<si>')
        .slice(1)
        .map(function (chunk) {
          var si = chunk.split('</si>')[0];
          var runs = si.split('<t').slice(1);
          var text = '';
          runs.forEach(function (r) {
            var gt = r.indexOf('>');
            if (gt < 0) return;
            var close = r.indexOf('</t>');
            if (close > gt) text += r.slice(gt + 1, close);
          });
          return xmlUnescape(text);
        });
    }
    function colNum(ref) {
      var n = 0;
      for (var i = 0; i < ref.length; i++) {
        var c = ref.charCodeAt(i);
        if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
        else break;
      }
      return n - 1;
    }
    var sheets = [];
    Object.keys(byName)
      .sort()
      .forEach(function (n) {
        if (!/^xl\/worksheets\/sheet\d*\.xml$/.test(n)) return;
        var xs = decodeUtf8(byName[n].data);
        var rows = [];
        xs.split('<row')
          .slice(1)
          .forEach(function (rc) {
            var rowMatch = /\sr="(\d+)"/.exec(rc.slice(0, rc.indexOf('>')));
            var ri = rowMatch ? parseInt(rowMatch[1], 10) - 1 : rows.length;
            var cells = rc.split('<c');
            cells.shift(); // the fragment before the first <c
            var row = rows[ri] || [];
            cells.forEach(function (cs) {
              var head = cs.slice(0, cs.indexOf('>'));
              var refM = /\sr="([A-Z]+\d+)"/.exec(head);
              var tM = /\st="([^"]+)"/.exec(head);
              var ci = refM ? colNum(refM[1]) : row.length;
              var t = tM ? tM[1] : 'n';
              var v = '';
              if (t === 'inlineStr' || t === 'str') {
                var is = cs.indexOf('<t');
                var close = cs.indexOf('</t>');
                if (is > -1 && close > is)
                  v = xmlUnescape(cs.slice(cs.indexOf('>', is) + 1, close));
              } else {
                var vm = /<v>([\s\S]*?)<\/v>/.exec(cs);
                v = vm ? vm[1] : '';
                if (t === 's') v = shared[parseInt(v, 10)] || '';
                else if (t !== 'b' && v !== '' && isFinite(Number(v))) v = Number(v);
              }
              row[ci] = v;
            });
            rows[ri] = row;
          });
        // trim ragged trailing empties per row
        sheets.push({
          name: n,
          rows: rows.map(function (r) {
            var out2 = r || [];
            while (
              out2.length &&
              (out2[out2.length - 1] === '' || out2[out2.length - 1] === undefined)
            )
              out2.pop();
            return out2;
          })
        });
      });
    if (!sheets.length) throw new Error('No worksheet found in that spreadsheet.');
    return sheets;
  }

  ns.XlsxLite = {
    build: build,
    crc32: crc32,
    inflateRaw: inflateRaw,
    zipEntries: zipEntries,
    read: read
  };
})();
