/* ============================================================
   My MaNaGeR, process model (Huly-inspired)
   ------------------------------------------------------------
   A status is a state and a move is an edge. This module owns the
   allowed edges for change requests and issues, the requirements
   each edge declares, and the append-only transition history.

   Pure: every function takes the state it reads and writes. No DOM,
   no storage, no timers. The callers (Changes.updChange,
   Risks.updIssue, App.resolveIssue) wrap these in updateState, so a
   move and its history entry land in the same update.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const CHANGE_STATUSES = ['submitted', 'review', 'approved', 'rejected', 'cancelled'];
  const ISSUE_STATUSES = ['open', 'resolved', 'closed'];

  const CHANGE_LABEL = {
    submitted: 'Submitted',
    review: 'In review',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled'
  };
  const ISSUE_LABEL = { open: 'Open', resolved: 'Resolved', closed: 'Closed' };

  // A missing edge is a refusal. A requirement is a field the record must
  // already carry for the edge to be taken.
  const CHANGE_EDGES = {
    submitted: { review: { approver: true }, cancelled: {} },
    review: {
      approved: { approver: true, title: true },
      rejected: { reason: true },
      cancelled: {}
    },
    approved: {},
    rejected: {},
    cancelled: {}
  };
  const ISSUE_EDGES = {
    open: { resolved: { reason: true } },
    resolved: { closed: {}, open: {} },
    closed: {}
  };

  const MAX_REASON = 2000;

  function nowIso() {
    return new Date().toISOString();
  }

  function genId() {
    return 'tr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function labels(kind) {
    return kind === 'issue' ? ISSUE_LABEL : CHANGE_LABEL;
  }

  function edges(kind) {
    return kind === 'issue' ? ISSUE_EDGES : CHANGE_EDGES;
  }

  function statuses(kind) {
    return kind === 'issue' ? ISSUE_STATUSES : CHANGE_STATUSES;
  }

  function defaultStatus(kind) {
    return kind === 'issue' ? 'open' : 'submitted';
  }

  function records(state, kind) {
    const key = kind === 'issue' ? 'issues' : 'changes';
    return state && Array.isArray(state[key]) ? state[key] : [];
  }

  function recordAt(state, kind, index) {
    return records(state, kind)[index] || null;
  }

  function statusOf(kind, record) {
    const s = record && record.status;
    return statuses(kind).indexOf(s) > -1 ? s : defaultStatus(kind);
  }

  function approverOf(state, record) {
    return String((record && record.approvedBy) || (state && state.userName) || '').trim();
  }

  function reasonOf(kind, record, opts) {
    const supplied = opts && typeof opts.reason === 'string' ? opts.reason : '';
    if (kind === 'issue') {
      return String(supplied || (record && record.resolution) || '').trim();
    }
    return String((record && record.notes) || '').trim();
  }

  function label(kind, status) {
    return labels(kind)[status] || status;
  }

  function refusal(kind, from, to) {
    const L = labels(kind);
    let tail = '';
    if (from === 'submitted' && to === 'approved') {
      tail = ' Review it first.';
    } else if (
      from === 'approved' ||
      from === 'rejected' ||
      from === 'cancelled' ||
      from === 'closed'
    ) {
      tail = ' That status is final.';
    } else if (from === 'review' && to === 'submitted') {
      tail = ' A reviewed record can only be approved, rejected or cancelled.';
    }
    return {
      ok: false,
      reason: 'illegal',
      message:
        'A ' + kind + ' in ' + (L[from] || from) + ' cannot move to ' + (L[to] || to) + '.' + tail
    };
  }

  // The one place a move is judged. Every write path calls this.
  function canMove(state, kind, index, to, opts) {
    const record = recordAt(state, kind, index);
    if (!record) {
      return { ok: false, reason: 'missing', message: 'That record no longer exists.' };
    }
    if (statuses(kind).indexOf(to) < 0) {
      return { ok: false, reason: 'unknown', message: 'That is not a status this register uses.' };
    }
    const from = statusOf(kind, record);
    if (from === to) {
      return { ok: true, noop: true };
    }
    const edge = (edges(kind)[from] || {})[to];
    if (!edge) {
      return refusal(kind, from, to);
    }
    if (edge.approver && !approverOf(state, record)) {
      return {
        ok: false,
        reason: 'approver',
        message:
          'Set your name in Controls (Profile) before moving a change to ' + label(kind, to) + '.'
      };
    }
    if (edge.title && !String(record.title || '').trim()) {
      return {
        ok: false,
        reason: 'title',
        message: 'Give the change a title before approving it.'
      };
    }
    if (edge.reason && !reasonOf(kind, record, opts)) {
      return {
        ok: false,
        reason: 'reason',
        message:
          kind === 'issue'
            ? 'Say what was done before resolving this issue.'
            : 'Write a reason in Notes before rejecting this change.'
      };
    }
    if (
      kind === 'change' &&
      to === 'approved' &&
      record.secondApproverRequired === true &&
      !String(record.secondApprover || '').trim()
    ) {
      return {
        ok: false,
        reason: 'second-approver',
        message: 'This change needs a second approver before it can be approved.'
      };
    }
    return { ok: true };
  }

  function appendHistory(state, entry) {
    if (!Array.isArray(state.transitions)) {
      state.transitions = [];
    }
    const row = {
      id: genId(),
      kind: entry.kind === 'issue' ? 'issue' : 'change',
      ref: String(entry.ref || ''),
      field: entry.field || 'status',
      from: String(entry.from || ''),
      to: String(entry.to || ''),
      by: String(entry.by || ''),
      at: entry.at || nowIso(),
      reason: String(entry.reason || '').slice(0, MAX_REASON),
      via: entry.via || 'user'
    };
    state.transitions.push(row);
    return row;
  }

  function applyMove(state, kind, index, to, opts) {
    const res = canMove(state, kind, index, to, opts);
    if (!res.ok || res.noop) {
      return res;
    }
    const record = recordAt(state, kind, index);
    const from = statusOf(kind, record);
    const by = String((state && state.userName) || '').trim();
    const reason = reasonOf(kind, record, opts);
    record.status = to;
    if (kind === 'change' && to === 'approved' && !String(record.approvedBy || '').trim()) {
      record.approvedBy = by;
    }
    if (kind === 'issue' && to === 'resolved' && opts && opts.reason) {
      record.resolution = String(opts.reason).slice(0, MAX_REASON);
    }
    appendHistory(state, {
      kind: kind,
      ref: record.id || '',
      from: from,
      to: to,
      by: by,
      reason: reason,
      via: (opts && opts.via) || 'user'
    });
    return { ok: true, from: from, to: to };
  }

  function historyFor(state, kind, ref) {
    const rows = state && Array.isArray(state.transitions) ? state.transitions : [];
    return rows
      .filter(function (r) {
        return r && r.kind === kind && r.ref === ref;
      })
      .sort(function (a, b) {
        return String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id));
      });
  }

  function feed(state, kind) {
    const rows = state && Array.isArray(state.transitions) ? state.transitions : [];
    return rows
      .filter(function (r) {
        return r && (!kind || r.kind === kind);
      })
      .sort(function (a, b) {
        return String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id));
      });
  }

  // ---- Repair -----------------------------------------------------------
  // An imported or legacy record must not keep a status its edge could not
  // have produced. The step back is recorded, never silent.
  function plannedRepair(kind, record, state) {
    const s = record && record.status;
    if (statuses(kind).indexOf(s) < 0) {
      return { to: defaultStatus(kind), why: 'unknown status' };
    }
    if (kind === 'change') {
      if (s === 'review' && !String(record.requester || '').trim()) {
        return { to: 'submitted', why: 'in review with no requester' };
      }
      if (s === 'approved' && !approverOf(state, record)) {
        return { to: 'review', why: 'approved with no approver' };
      }
      if (s === 'approved' && !String(record.title || '').trim()) {
        return { to: 'review', why: 'approved with no title' };
      }
    }
    if (kind === 'issue' && s === 'resolved' && !String(record.resolution || '').trim()) {
      return { to: 'open', why: 'resolved with no note' };
    }
    return null;
  }

  function needsRepair(state) {
    return ['change', 'issue'].some(function (kind) {
      return records(state, kind).some(function (r) {
        return !!plannedRepair(kind, r, state);
      });
    });
  }

  function repairAll(state) {
    let made = 0;
    ['change', 'issue'].forEach(function (kind) {
      records(state, kind).forEach(function (record) {
        const plan = plannedRepair(kind, record, state);
        if (!plan) {
          return;
        }
        const from = record.status;
        record.status = plan.to;
        appendHistory(state, {
          kind: kind,
          ref: record.id || '',
          from: from,
          to: plan.to,
          by: '',
          reason: 'Repaired on read: ' + plan.why + '.',
          via: 'repair'
        });
        made += 1;
      });
    });
    return made;
  }

  ns.Process = {
    CHANGE_STATUSES: CHANGE_STATUSES,
    ISSUE_STATUSES: ISSUE_STATUSES,
    CHANGE_LABEL: CHANGE_LABEL,
    ISSUE_LABEL: ISSUE_LABEL,
    CHANGE_EDGES: CHANGE_EDGES,
    ISSUE_EDGES: ISSUE_EDGES,
    statuses: statuses,
    label: label,
    canMove: canMove,
    applyMove: applyMove,
    appendHistory: appendHistory,
    historyFor: historyFor,
    feed: feed,
    needsRepair: needsRepair,
    repairAll: repairAll
  };
})(MMGR);
window.MMGR = MMGR;
