#!/usr/bin/env python
"""Open a produced .xlsx the way a user's machine does.

Python's zipfile validates the container (testzip() must return None), the
sheet XML is parsed with ElementTree, and the Summary sheet's ESTIMATED TOTAL
line must carry the number the estimate printed.

    python tools/xlsx-probe.py tmp/export-case.xlsx 1234.56
    exit 0 = openable and the total matches, 1 = not
"""
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def fail(msg):
    sys.stderr.write(msg + '\n')
    sys.exit(1)


def sheet_rows(xml_bytes):
    root = ET.fromstring(xml_bytes)
    rows = []
    for row in root.findall('.//m:sheetData/m:row', NS):
        cells = []
        for c in row.findall('m:c', NS):
            t = c.get('t')
            if t == 'inlineStr':
                node = c.find('.//m:t', NS)
                cells.append(node.text if node is not None else '')
            else:
                v = c.find('m:v', NS)
                cells.append(v.text if v is not None else '')
        rows.append(cells)
    return rows


def main():
    if len(sys.argv) < 2:
        fail('usage: xlsx-probe.py <file.xlsx> [expected-total]')
    path = sys.argv[1]
    want = float(sys.argv[2]) if len(sys.argv) > 2 else None

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

    # workbook.xml must name four sheets, in the order we wrote them.
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    names = [s.get('name') for s in wb.findall('.//m:sheet', NS)]
    if names != ['Summary', 'Cost breakdown', 'Assumptions', 'Bill of quantities']:
        fail('unexpected sheet list: %r' % (names,))

    rows = sheet_rows(z.read('xl/worksheets/sheet1.xml'))
    total = None
    for r in rows:
        if len(r) >= 2 and r[0] == 'ESTIMATED TOTAL':
            total = float(r[1])
            break
    if total is None:
        fail('the Summary sheet has no ESTIMATED TOTAL row')
    if want is not None and abs(total - want) > 0.005:
        fail('Summary total %.2f != estimate %.2f' % (total, want))
    print('ok sheets=%d summary_total=%.2f bytes=%d' % (len(names), total, len(z.read('xl/worksheets/sheet1.xml'))))


if __name__ == '__main__':
    main()
