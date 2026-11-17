/* ============================================================
   My MaNaGeR - book-import
   ============================================================
   Reads a person's OWN rate book out of the file they already have:
   .xlsx, .docx, .pdf, .csv, .tsv, .txt or .md. Every rate line comes
   back as one plain record - description, unit, rate - because a
   user's book does not share the built-in book's work keys.

   Contract (used by js/calculator-page.js, tested by
   tools/qa-calculator-page.cjs):

     MMGR.BookImport.parse(file, function (out) {
       out.name  - the file name without its extension (the book name)
       out.rows  - [{ trade, desc, unit, rate }], in file order
       out.error - a plain sentence when nothing could be read
     })

   It NEVER throws: an unreadable file comes back as rows [] plus a
   sentence the page shows in its status line. PDF text comes from the
   SAME extractor the assistant's attachments use (window.MMGR_PDF_TEXT),
   so one PDF behaves the same in both places. No dependencies: the
   .xlsx / .docx readers are the app's own ZIP primitives.
   ============================================================ */
(function () {
  'use strict';
  var ns = (window.MMGR = window.MMGR || {});

  // A unit a rate book actually prints. Anything else is left empty and the
  // row reads "each", so a guess is never invented for the user's own money.
  var UNIT_RE =
    /^(m|m2|m²|m3|m³|mm|cm|km|ft|ft2|ft²|ft3|ft³|in|yd|yd2|yd²|yd3|yd³|sq\.?\s?ft|sq\.?\s?m|cum|sqm|lm|kg|t|ton|tonne|lb|l|litre|liter|hr|hour|day|wk|week|each|ea|no|nos|pc|pcs|piece|lot|job|roll|bag|set|pair|gal|gallon|block|sheet|length)$/i;

  function num(v) {
    var s = String(v == null ? '' : v)
      .replace(/[J$,]/gi, '')
      .replace(/[^\d.\-]/g, '')
      .trim();
    var n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : NaN;
  }

  function unitOf(v) {
    var s = String(v == null ? '' : v)
      .replace(/[.,;:]+$/, '')
      .trim();
    return UNIT_RE.test(s) ? s : '';
  }

  // One matrix row -> one rate record (or null). The rate is the column the
  // header names, else the LAST number on the row; the unit is the column the
  // header names, else the one cell that is a known unit; the description is
  // the header's column, else the longest remaining text cell.
  function rowFromCells(cells, bookName, cols) {
    var list = (cells || []).map(function (c) {
      return String(c == null ? '' : c).trim();
    });
    if (!list.length) {
      return null;
    }
    var rate = cols && cols.rate >= 0 ? num(list[cols.rate]) : NaN;
    var rateIdx = cols && cols.rate >= 0 ? cols.rate : -1;
    if (!(rate > 0)) {
      for (var ci = list.length - 1; ci >= 0; ci--) {
        var n = num(list[ci]);
        if (n > 0) {
          rate = n;
          rateIdx = ci;
          break;
        }
      }
    }
    if (!(rate > 0)) {
      return null;
    }
    var unit = cols && cols.unit >= 0 ? unitOf(list[cols.unit]) : '';
    var desc = cols && cols.desc >= 0 ? list[cols.desc] : '';
    var trade = cols && cols.trade >= 0 ? list[cols.trade] : '';
    if (!unit) {
      for (var ui = 0; ui < list.length; ui++) {
        if (ui === rateIdx) {
          continue;
        }
        var u = unitOf(list[ui]);
        if (u) {
          unit = u;
          break;
        }
      }
    }
    if (!desc) {
      var best = '';
      list.forEach(function (c, i) {
        if (i === rateIdx || c === unit) {
          return;
        }
        if (c.length > best.length) {
          best = c;
        }
      });
      desc = best;
    }
    desc = desc.replace(/\s+/g, ' ').trim();
    if (desc.length < 3) {
      return null;
    }
    // Header, subtotal and tax lines are not rates.
    if (
      /^(item|description|trade|rate|unit|price|amount|qty|quantity|code|ref|no\.?)$/i.test(desc)
    ) {
      return null;
    }
    if (/^(sub\s*-?\s*total|total|carried|vat|gct|tax|discount)\b/i.test(desc)) {
      return null;
    }
    return {
      trade: (trade || bookName).slice(0, 60),
      desc: desc.slice(0, 160),
      unit: (unit || 'each').slice(0, 20),
      rate: Math.round(rate * 100) / 100
    };
  }

  // Find a header row and the columns it names. Only a row with no numbers of
  // its own qualifies, so a data line that happens to say "rate" is never
  // mistaken for the header.
  function columns(matrix) {
    for (var i = 0; i < Math.min(matrix.length, 12); i++) {
      var cells = (matrix[i] || []).map(function (c) {
        return String(c == null ? '' : c).toLowerCase();
      });
      var numbered = cells.some(function (c) {
        return num(c) > 0;
      });
      if (numbered) {
        continue;
      }
      var hasRate = cells.some(function (c) {
        return /rate|price|amount|cost|j\$/.test(c);
      });
      var hasDesc = cells.some(function (c) {
        return /desc|item|work|activity|line|trade/.test(c);
      });
      if (!hasRate || !hasDesc) {
        continue;
      }
      var cols = { desc: -1, unit: -1, rate: -1, trade: -1 };
      cells.forEach(function (c, ci) {
        if (cols.rate < 0 && /rate|price|amount|cost|j\$/.test(c)) {
          cols.rate = ci;
        } else if (cols.unit < 0 && /unit|uom|measure/.test(c)) {
          cols.unit = ci;
        } else if (cols.desc < 0 && /desc|item|work|activity|line/.test(c)) {
          cols.desc = ci;
        } else if (cols.trade < 0 && /trade|category|section|discipline/.test(c)) {
          cols.trade = ci;
        }
      });
      return { cols: cols, start: i + 1 };
    }
    return { cols: null, start: 0 };
  }

  function rowsFromMatrix(matrix, bookName) {
    var rows = [];
    var head = columns(matrix);
    matrix.slice(head.start).forEach(function (cells) {
      var rec = rowFromCells(cells, bookName, head.cols);
      if (rec) {
        rows.push(rec);
      }
    });
    return rows;
  }

  // Text (CSV, PDF text, Word paragraphs): split on tabs, runs of two or more
  // spaces, or a pipe - the three ways a printed table keeps its columns. A
  // line with none of them keeps its trailing number as the rate.
  function rowsFromText(text, bookName) {
    var rows = [];
    String(text || '')
      .split(/\r?\n/)
      .forEach(function (line) {
        var s = line.replace(/\u00a0/g, ' ').trim();
        if (s.length < 4) {
          return;
        }
        var cells = s
          .split(/\t+|\s{2,}|\s*\|\s*/)
          .map(function (c) {
            return c.trim();
          })
          .filter(function (c) {
            return c !== '';
          });
        if (cells.length < 2) {
          var m = /^(.*?)[\s:]+([\d][\d,.]*)\s*$/.exec(s);
          if (!m) {
            return;
          }
          cells = [m[1].trim(), m[2]];
        }
        var rec = rowFromCells(cells, bookName, null);
        if (rec) {
          rows.push(rec);
        }
      });
    return rows;
  }

  function csvMatrix(text) {
    var out = [];
    String(text || '')
      .split(/\r?\n/)
      .forEach(function (line) {
        if (!line.trim()) {
          return;
        }
        var cells = [];
        var cur = '';
        var quoted = false;
        for (var i = 0; i < line.length; i++) {
          var ch = line[i];
          if (quoted) {
            if (ch === '"' && line[i + 1] === '"') {
              cur += '"';
              i++;
            } else if (ch === '"') {
              quoted = false;
            } else {
              cur += ch;
            }
          } else if (ch === '"') {
            quoted = true;
          } else if (ch === ',' || ch === ';') {
            cells.push(cur.trim());
            cur = '';
          } else {
            cur += ch;
          }
        }
        cells.push(cur.trim());
        out.push(cells);
      });
    return out;
  }

  // Read ONE uploaded file into rate records. Never throws: every failure comes
  // back as a plain sentence the caller's status line can show.
  function parse(file, done) {
    var ext = (
      '.' +
      String(file.name || '')
        .split('.')
        .pop()
    ).toLowerCase();
    var base =
      String(file.name || '')
        .replace(/\.[^.]+$/, '')
        .trim()
        .slice(0, 60) || 'My rate book';
    var finish = function (rows, error) {
      done({ name: base, rows: rows || [], error: error || '' });
    };
    var reader = new FileReader();
    reader.onerror = function () {
      finish([], 'That file could not be read. Try again, or save it as CSV.');
    };
    reader.onload = function () {
      try {
        if (ext === '.xlsx') {
          var sheets = ns.XlsxLite.read(new Uint8Array(reader.result));
          var rows = rowsFromMatrix(sheets[0].rows || [], base);
          finish(rows, rows.length ? '' : 'No rate lines were found in that spreadsheet.');
          return;
        }
        if (ext === '.docx') {
          var doc = ns.DocxLite.read(new Uint8Array(reader.result));
          var found = [];
          (doc.tables || []).forEach(function (table) {
            found = found.concat(rowsFromMatrix(table, base));
          });
          if (!found.length) {
            found = rowsFromText(doc.text, base);
          }
          finish(found, found.length ? '' : 'No rate lines were found in that document.');
          return;
        }
        if (ext === '.pdf') {
          if (typeof window.MMGR_PDF_TEXT !== 'function') {
            finish([], 'PDF reading is not available on this page. Save the book as CSV instead.');
            return;
          }
          window.MMGR_PDF_TEXT(reader.result).then(function (r) {
            if (!r || !r.ok) {
              finish([], 'That PDF has no text layer to read. Save the book as CSV instead.');
              return;
            }
            var text = rowsFromText(r.text, base);
            finish(text, text.length ? '' : 'No rate lines were found in that PDF.');
          });
          return;
        }
        var body = String(reader.result || '');
        var lines =
          ext === '.csv' || ext === '.tsv'
            ? rowsFromMatrix(csvMatrix(body), base)
            : rowsFromText(body, base);
        finish(lines, lines.length ? '' : 'No rate lines were found in that file.');
      } catch (e) {
        finish([], 'That file could not be read as a rate book. Save it as CSV and try again.');
      }
    };
    if (ext === '.csv' || ext === '.tsv' || ext === '.txt' || ext === '.md') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  ns.BookImport = { parse: parse };
})();
