#!/usr/bin/env python
"""Open a produced .xlsx the way a user's machine does.

Python's zipfile validates the container (testzip() must return None), the
sheet XML is parsed with ElementTree, and the Summary sheet's ESTIMATED TOTAL
line must carry the number the estimate printed.

G-8 (FIELD-FINDINGS-DIRECTIVE-2026-10-28) also proves the FORMATTING contract:
widths measured from the cells, wrapped long text, a frozen bold header on a
fill, a number format on every money cell, landscape fit-to-width with the
header repeated, the Cost breakdown's arithmetic columns, no placeholder
assumption row, and - when a CSV is handed in - the same numbers in both files.

    python tools/xlsx-probe.py tmp/export-case.xlsx 1234.56 [tmp/export-case.csv]
    exit 0 = openable and the contract holds, 1 = not
"""
import csv
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

MONEY_FMT = {'164', '165'}
SHEETS = ['Summary', 'Cost breakdown', 'Assumptions', 'Bill of quantities']


def fail(msg):
    sys.stderr.write(msg + '\n')
    sys.exit(1)


def col_index(ref):
    letters = ''.join(ch for ch in (ref or '') if ch.isalpha())
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


def sheet_cells(xml_bytes):
    """Rows of (text, numeric, style-index), placed by their cell reference so
    an empty cell never shifts the columns that follow it."""
    root = ET.fromstring(xml_bytes)
    out = []
    for row in root.findall('.//m:sheetData/m:row', NS):
        cells = []
        for c in row.findall('m:c', NS):
            ci = col_index(c.get('r'))
            if ci < 0:
                ci = len(cells)
            while len(cells) < ci:
                cells.append(('', False, 0))
            style = int(c.get('s') or 0)
            if c.get('t') == 'inlineStr':
                node = c.find('.//m:t', NS)
                cells.append((node.text if node is not None else '', False, style))
            else:
                v = c.find('m:v', NS)
                cells.append((v.text if v is not None else '', True, style))
        out.append(cells)
    return out


def styles(z):
    root = ET.fromstring(z.read('xl/styles.xml'))
    xfs = root.findall('.//m:cellXfs/m:xf', NS)
    out = []
    for xf in xfs:
        align = xf.find('m:alignment', NS)
        out.append({
            'numFmt': xf.get('numFmtId') or '0',
            'wrap': bool(align is not None and align.get('wrapText') in ('1', 'true')),
            'font': xf.get('fontId') or '0',
            'fill': xf.get('fillId') or '0',
        })
    return out


def display_len(text, numeric):
    if not numeric:
        return len(text or '')
    try:
        n = float(text)
    except ValueError:
        return len(text or '')
    return len('%.2f' % n) + (2 if abs(n) >= 1000 else 0)


def main():
    if len(sys.argv) < 2:
        fail('usage: xlsx-probe.py <file.xlsx> [expected-total] [csv]')
    path = sys.argv[1]
    want = float(sys.argv[2]) if len(sys.argv) > 2 else None
    csv_path = sys.argv[3] if len(sys.argv) > 3 else None

    try:
        z = zipfile.ZipFile(path)
    except Exception as exc:  # noqa: BLE001 - the point is to report it
        fail('not a ZIP: %s' % exc)

    bad = z.testzip()
    if bad is not None:
        fail('ZIP member failed its CRC: %s' % bad)

    for need in ('[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml',
                 'xl/worksheets/sheet1.xml'):
        if need not in z.namelist():
            fail('missing part: %s' % need)

    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.get('name') for s in wb.findall('.//m:sheet', NS)]
    if names != SHEETS:
        fail('unexpected sheet list: %r' % (names,))

    # G-8: the header row repeats on every printed page.
    titles = {}
    for d in wb.findall('.//m:definedName', NS):
        if d.get('name') == '_xlnm.Print_Titles':
            titles[d.get('localSheetId')] = (d.text or '')
    for i, nm in enumerate(names):
        if '$1:$1' not in titles.get(str(i), '') or nm not in titles.get(str(i), ''):
            fail('sheet %r has no repeated header row' % nm)

    st = styles(z)

    def style_of(cell):
        s = cell[2]
        if s < 0 or s >= len(st):
            fail('cell uses an undefined style %d' % s)
        return st[s]

    all_sheets = {}
    for i, nm in enumerate(names):
        part = 'xl/worksheets/sheet%d.xml' % (i + 1)
        root = ET.fromstring(z.read(part))
        view = root.find('.//m:sheetView', NS)
        pane = view.find('m:pane', NS) if view is not None else None
        if pane is None or pane.get('state') != 'frozen' or int(pane.get('ySplit') or 0) < 1:
            fail('sheet %r does not freeze its header row' % nm)
        setup = root.find('.//m:pageSetup', NS)
        if setup is None or setup.get('orientation') != 'landscape' or setup.get('fitToWidth') != '1':
            fail('sheet %r is not landscape fit-to-width' % nm)
        cells = sheet_cells(z.read(part))
        if not cells:
            fail('sheet %r is empty' % nm)
        for c in cells[0]:
            if c[0] == '':
                continue
            s = style_of(c)
            if s['font'] != '1' or s['fill'] != '2':
                fail('sheet %r header is not bold on a fill' % nm)
        widths = {}
        for c in root.findall('.//m:cols/m:col', NS):
            widths[int(c.get('min')) - 1] = float(c.get('width') or 0)
        ncols = max(len(r) for r in cells)
        for ci in range(ncols):
            longest = 0
            for row in cells:
                if ci < len(row):
                    longest = max(longest, display_len(row[ci][0], row[ci][1]))
            need = min(60, max(12, longest + 2))
            if widths.get(ci, 0) < need:
                fail('sheet %r column %d is %.1f wide, needs %.1f'
                     % (nm, ci + 1, widths.get(ci, 0), need))
        for row in cells:
            for ci, c in enumerate(row):
                if not c[1] and len(c[0] or '') > widths.get(ci, 12):
                    if not style_of(c)['wrap']:
                        fail('sheet %r cell %d has long text with no wrap' % (nm, ci + 1))
        all_sheets[nm] = cells

    # ---- Summary total ------------------------------------------------------
    total = None
    for r in all_sheets['Summary']:
        if len(r) >= 2 and r[0][0] == 'ESTIMATED TOTAL':
            total = float(r[1][0])
            break
    if total is None:
        fail('the Summary sheet has no ESTIMATED TOTAL row')
    if want is not None and abs(total - want) > 0.005:
        fail('Summary total %.2f != estimate %.2f' % (total, want))

    # ---- money cells carry a number format ----------------------------------
    money_cols = {'Summary': [1], 'Cost breakdown': [2, 4, 6], 'Bill of quantities': [3]}
    for nm, cols in money_cols.items():
        for row in all_sheets[nm][1:]:
            for ci in cols:
                if ci < len(row) and row[ci][1] and row[ci][0] != '':
                    if style_of(row[ci])['numFmt'] not in MONEY_FMT:
                        fail('sheet %r column %d money cell has no number format' % (nm, ci + 1))

    # ---- Cost breakdown keeps the arithmetic --------------------------------
    head = [c[0] for c in all_sheets['Cost breakdown'][0]]
    if head[:7] != ['Line', 'Detail', 'Quantity', 'Unit', 'Rate', 'Rate unit', 'Amount']:
        fail('Cost breakdown header is %r' % (head,))
    priced = [r for r in all_sheets['Cost breakdown'][1:]
              if len(r) >= 7 and r[4][0] != '' and r[6][0] != '']
    if not priced:
        fail('Cost breakdown carries no row with a quantity, unit and rate')
    if not any(len(r) >= 7 and r[2][0] != '' and r[3][0] != '' and r[4][0] != '' for r in priced):
        fail('Cost breakdown drops quantity, unit or rate on its priced rows')

    # ---- no placeholder assumption ------------------------------------------
    for r in all_sheets['Assumptions'][1:]:
        val = (r[1][0] if len(r) > 1 else '') or ''
        if val.strip() in ('', '-', 'none', 'no'):
            fail('Assumptions carries a placeholder row: %r' % ([c[0] for c in r],))

    # ---- the CSV and the sheet carry the same numbers ------------------------
    if csv_path:
        with open(csv_path, 'r', encoding='utf-8-sig', newline='') as fh:
            rows = list(csv.DictReader(fh))
        if not rows:
            fail('the CSV is empty')
        csv_total = None
        csv_sub = None
        for r in rows:
            if r['section'] == 'Total':
                csv_total = float(r['amount'])
            if r['section'] == 'Cost' and r['item'].startswith('Subtotal (before'):
                csv_sub = float(r['amount'])
        if csv_total is None:
            fail('the CSV has no Total row')
        if abs(csv_total - total) > 0.005:
            fail('CSV total %.2f != sheet total %.2f' % (csv_total, total))
        if csv_sub is not None:
            for r in all_sheets['Cost breakdown'][1:]:
                if r and r[0][0] == 'Subtotal (before overhead and margin)':
                    if len(r) < 7 or r[6][0] == '':
                        fail('the subtotal row carries no amount')
                    if abs(float(r[6][0]) - csv_sub) > 0.005:
                        fail('CSV subtotal %.2f != sheet subtotal %s' % (csv_sub, r[6][0]))
                    break

    print('ok sheets=%d summary_total=%.2f bytes=%d'
          % (len(names), total, len(z.read('xl/worksheets/sheet1.xml'))))


if __name__ == '__main__':
    main()
