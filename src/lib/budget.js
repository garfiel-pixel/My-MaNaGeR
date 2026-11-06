/* ============================================================
   BUDGET PROPOSALS - one validator, two callers
   ------------------------------------------------------------
   H-5/H-6 of the BUDGET-BOQ directive (2026-11-05). The MCP server
   queues a proposal through buildBudgetProposal; the owner's approval
   preview rebuilds the SAME proposal from the approved, possibly
   edited changes through the same function. One validator means the
   browser can never apply something the server would have refused.

   Every money value is a finite number, never a string; a delivery
   needs a quantity and a price; the amount is computed HERE; a unit
   must belong to the line's unit family. There is no delete.
   ============================================================ */
const BUDGET_LARGE_ABS = 50000; // Q5: 10 percent of the line, or this, whichever is smaller
const BUDGET_PROPOSAL_LIMIT = 25; // changes in one proposal
const BUDGET_LARGE_PER_DAY = 10; // large changes one key may queue in a day

function round2(n) {
  return Math.round((+n || 0) * 100) / 100;
}
function isMoney(v) {
  return typeof v === 'number' && isFinite(v);
}
function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').slice(0, 10));
  if (!m) {
    return null;
  }
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(d.getTime()) ? null : d;
}

// ---- H-5 unit families ----------------------------------------------------
// A delivery's unit must belong to the same family as its line's unit, so
// "20 loads" can never be recorded against a line priced in cubic metres.
// Unknown units are compared literally (case and spaces normalised).
const UNIT_FAMILY = {
  m: 'length',
  metre: 'length',
  meter: 'length',
  lm: 'length',
  'lin m': 'length',
  'linear m': 'length',
  ft: 'length',
  'lin ft': 'length',
  m2: 'area',
  'm²': 'area',
  sqm: 'area',
  'sq m': 'area',
  'sq ft': 'area',
  ft2: 'area',
  m3: 'volume',
  'm³': 'volume',
  cum: 'volume',
  'cu m': 'volume',
  'cu yd': 'volume',
  yd3: 'volume',
  kg: 'mass',
  t: 'mass',
  tonne: 'mass',
  ton: 'mass',
  lb: 'mass',
  hr: 'time',
  hour: 'time',
  h: 'time',
  day: 'time',
  wk: 'time',
  week: 'time',
  ea: 'count',
  each: 'count',
  no: 'count',
  pc: 'count',
  pcs: 'count',
  unit: 'count',
  load: 'load',
  trip: 'load',
  bag: 'bag',
  roll: 'roll',
  sheet: 'sheet'
};
function unitFamily(u) {
  const k = String(u == null ? '' : u)
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  return UNIT_FAMILY[k] || (k ? 'custom:' + k : '');
}
function unitsMatch(a, b) {
  const fa = unitFamily(a);
  const fb = unitFamily(b);
  if (!fa || !fb) {
    return true;
  }
  return fa === fb;
}

const BUDGET_LINE_FIELDS = ['name', 'category', 'planned', 'qty', 'unit', 'rate', 'boqRef'];
const BUDGET_MONEY_FIELDS = { planned: 1, qty: 1, rate: 1 };
const DELIVERY_STATUSES = { ordered: 1, received: 1, paid: 1 };

function fmtNum(n) {
  const v = Math.round((+n || 0) * 100) / 100;
  const parts = String(Math.abs(v)).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (v < 0 ? '-' : '') + parts.join('.');
}

function buildBudgetProposal(prev, rawList, currency) {
  const refused = [];
  const changes = [];
  const base = JSON.parse(JSON.stringify(prev || {}));
  const lines = Array.isArray(base.budgetLines) ? base.budgetLines : (base.budgetLines = []);
  const spend = Array.isArray(base.spendLog) ? base.spendLog : (base.spendLog = []);
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);
  let nspid = +base.nspid || 1;
  let nextLineNo = 1;
  const usedIds = {};
  lines.forEach(l => {
    usedIds[String(l.id)] = 1;
    const m = /^B(\d+)$/.exec(String(l.id || ''));
    if (m) {
      nextLineNo = Math.max(nextLineNo, +m[1] + 1);
    }
  });
  const newLineId = function () {
    let id = 'B' + nextLineNo++;
    while (usedIds[id]) {
      id = 'B' + nextLineNo++;
    }
    usedIds[id] = 1;
    return id;
  };
  const findLine = function (id) {
    for (let i = 0; i < lines.length; i++) {
      if (String(lines[i].id) === String(id)) {
        return lines[i];
      }
    }
    return null;
  };
  const largeThreshold = function (planned) {
    return Math.min(Math.abs(planned || 0) * 0.1, BUDGET_LARGE_ABS);
  };

  rawList.forEach((raw, i) => {
    const at = 'budget ' + (i + 1);
    if (!raw || typeof raw !== 'object') {
      refused.push(at + ': not an object');
      return;
    }
    const kind = String(raw.kind || '');

    if (kind === 'addLine') {
      const src = raw.line && typeof raw.line === 'object' ? raw.line : null;
      if (!src) {
        refused.push(at + ': addLine needs a line object');
        return;
      }
      const name = String(src.name || src.category || '').trim();
      if (!name) {
        refused.push(at + ': the new line needs a name');
        return;
      }
      let planned = src.planned;
      if (planned === undefined && isMoney(src.qty) && isMoney(src.rate)) {
        planned = round2(src.qty * src.rate);
      }
      if (!isMoney(planned)) {
        refused.push(at + ': planned must be a number (no text, no blanks)');
        return;
      }
      if (planned < 0) {
        refused.push(at + ': planned cannot be negative');
        return;
      }
      if (src.qty !== undefined && (!isMoney(src.qty) || src.qty < 0)) {
        refused.push(at + ': quantity must be a number and cannot be negative');
        return;
      }
      if (src.rate !== undefined && (!isMoney(src.rate) || src.rate < 0)) {
        refused.push(at + ': rate must be a number and cannot be negative');
        return;
      }
      const line = {
        id: newLineId(),
        name: name,
        category: String(src.category || name),
        planned: round2(planned),
        actual: 0,
        qty: isMoney(src.qty) ? src.qty : null,
        unit: src.unit == null ? '' : String(src.unit).slice(0, 24),
        rate: isMoney(src.rate) ? src.rate : null,
        boqRef: src.boqRef == null ? '' : String(src.boqRef).slice(0, 80),
        source: 'manual',
        notes: src.notes == null ? '' : String(src.notes).slice(0, 500),
        taskId: '',
        linkedTaskId: src.linkedTaskId == null ? '' : String(src.linkedTaskId).slice(0, 64),
        curve: 'linear',
        waiverStatus: 'pending',
        waiverReceivedAt: '',
        committed: null
      };
      lines.push(line);
      const large = line.planned >= BUDGET_LARGE_ABS;
      changes.push({
        kind: 'addLine',
        lineId: line.id,
        before: null,
        after: {
          name: line.name,
          planned: line.planned,
          qty: line.qty,
          unit: line.unit,
          rate: line.rate
        },
        amount: line.planned,
        large: large,
        summary:
          'Add a budget line ' +
          line.name +
          ' planned at ' +
          fmtNum(line.planned) +
          (line.qty != null && line.rate != null
            ? ' (' +
              fmtNum(line.qty) +
              ' ' +
              (line.unit || 'units') +
              ' at ' +
              fmtNum(line.rate) +
              ')'
            : '')
      });
      return;
    }

    if (kind === 'changeLine') {
      const line = findLine(raw.lineId);
      if (!line) {
        refused.push(at + ': no budget line with id ' + String(raw.lineId || '(none)'));
        return;
      }
      const field = String(raw.field || '');
      if (BUDGET_LINE_FIELDS.indexOf(field) === -1) {
        refused.push(
          at +
            ': ' +
            (field || '(no field)') +
            ' cannot be changed here. Allowed: ' +
            BUDGET_LINE_FIELDS.join(', ') +
            '.'
        );
        return;
      }
      // The "before" is normally the live line value, but an approval preview
      // sends the value the proposal was made against so the accept handler can
      // detect a stale proposal (line changed since it was proposed). Prefer the
      // caller's before when present and numeric/parseable.
      const before = raw.before !== undefined && raw.before !== null ? raw.before : line[field];
      let after = raw.value;
      if (BUDGET_MONEY_FIELDS[field]) {
        if (!isMoney(after)) {
          refused.push(at + ': ' + field + ' must be a number (no text, no blanks)');
          return;
        }
        if (after < 0) {
          refused.push(at + ': ' + field + ' cannot be negative');
          return;
        }
        after = round2(after);
      } else {
        if (after === undefined || after === null) {
          refused.push(at + ': ' + field + ' needs a value');
          return;
        }
        after = String(after).slice(0, field === 'unit' ? 24 : 120);
      }
      if (String(before == null ? '' : before) === String(after)) {
        refused.push(at + ': ' + field + ' already has that value');
        return;
      }
      const delta = BUDGET_MONEY_FIELDS[field] ? after - (+before || 0) : 0;
      line[field] = after;
      const large = BUDGET_MONEY_FIELDS[field] && Math.abs(delta) >= largeThreshold(+before || 0);
      const label = line.category || line.name || line.id;
      changes.push({
        kind: 'changeLine',
        lineId: line.id,
        field: field,
        before: before == null ? null : before,
        after: after,
        delta: BUDGET_MONEY_FIELDS[field] ? round2(delta) : null,
        large: large,
        summary:
          'Change ' +
          label +
          ' ' +
          field +
          ' from ' +
          (BUDGET_MONEY_FIELDS[field]
            ? fmtNum(before)
            : String(before == null ? '(blank)' : before)) +
          ' to ' +
          (BUDGET_MONEY_FIELDS[field] ? fmtNum(after) : String(after)) +
          (BUDGET_MONEY_FIELDS[field] && delta
            ? ' (' + (delta > 0 ? '+' : '') + fmtNum(delta) + ')'
            : '')
      });
      return;
    }

    if (kind === 'addDelivery') {
      const line = findLine(raw.lineId);
      if (!line) {
        refused.push(at + ': no budget line with id ' + String(raw.lineId || '(none)'));
        return;
      }
      if (!isMoney(raw.qty) || raw.qty <= 0) {
        refused.push(at + ': quantity must be a number greater than zero');
        return;
      }
      if (!isMoney(raw.unitPrice)) {
        refused.push(at + ': unit price is required and must be a number (no text, no blanks)');
        return;
      }
      if (raw.unitPrice < 0) {
        refused.push(at + ': unit price cannot be negative');
        return;
      }
      const lineUnit = line.unit == null ? '' : String(line.unit);
      const unit = raw.unit == null ? lineUnit : String(raw.unit).slice(0, 24);
      if (raw.unit != null && lineUnit && !unitsMatch(unit, lineUnit)) {
        refused.push(
          at +
            ': unit ' +
            unit +
            ' does not match this line, which is measured in ' +
            lineUnit +
            '.'
        );
        return;
      }
      const date = raw.date == null || raw.date === '' ? today : String(raw.date).slice(0, 10);
      if (!parseISO(date)) {
        refused.push(at + ': date must be YYYY-MM-DD');
        return;
      }
      const status = raw.status == null ? 'received' : String(raw.status);
      if (!DELIVERY_STATUSES[status]) {
        refused.push(at + ': status must be ordered, received or paid');
        return;
      }
      const amount = round2(raw.qty * raw.unitPrice);
      const entry = {
        id: 'S' + nspid++,
        date: date,
        budgetLineId: line.id,
        amount: amount,
        qty: raw.qty,
        unitPrice: raw.unitPrice,
        unit: unit,
        supplierRef: raw.supplierRef == null ? '' : String(raw.supplierRef).slice(0, 80),
        status: status,
        notes: raw.note == null ? '' : String(raw.note).slice(0, 500)
      };
      spend.push(entry);
      const label = line.category || line.name || line.id;
      const large = amount >= largeThreshold(+line.planned || 0);
      changes.push({
        kind: 'addDelivery',
        lineId: line.id,
        deliveryId: entry.id,
        before: null,
        after: entry,
        amount: amount,
        large: large,
        summary:
          'Record ' +
          fmtNum(raw.qty) +
          ' ' +
          (unit || 'units') +
          ' of ' +
          label +
          ' at ' +
          fmtNum(raw.unitPrice) +
          ' per ' +
          (unit || 'unit') +
          ' (' +
          fmtNum(amount) +
          '), ' +
          status
      });
      return;
    }

    if (kind === 'deleteLine' || kind === 'removeLine') {
      refused.push(at + ': deleting a budget line is not available through MCP');
      return;
    }
    refused.push(
      at + ': unknown kind ' + (kind || '(none)') + ' (addLine, changeLine, addDelivery)'
    );
  });

  const submitted = {};
  if (changes.some(c => c.kind === 'addLine' || c.kind === 'changeLine')) {
    submitted.budgetLines = lines;
  }
  if (changes.some(c => c.kind === 'addDelivery')) {
    submitted.spendLog = spend;
    submitted.nspid = nspid;
  }
  const summary = changes.length
    ? changes.length +
      ' budget change' +
      (changes.length === 1 ? '' : 's') +
      ': ' +
      changes.map(c => c.summary).join('; ')
    : '';
  return {
    submitted: submitted,
    changes: changes,
    refused: refused,
    summary: summary,
    currency: currency || 'USD'
  };
}

export {
  BUDGET_LARGE_ABS,
  BUDGET_PROPOSAL_LIMIT,
  BUDGET_LARGE_PER_DAY,
  BUDGET_LINE_FIELDS,
  BUDGET_MONEY_FIELDS,
  round2,
  isMoney,
  parseISO,
  fmtNum,
  unitFamily,
  unitsMatch,
  buildBudgetProposal
};
