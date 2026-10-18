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

  ns.XlsxLite = { build: build, crc32: crc32 };
})();
