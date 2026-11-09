/* ============================================================
   My MaNaGeR, rules renderer (Huly-inspired)
   ------------------------------------------------------------
   The Rules section in the Controls accordion: the declared list, one
   fixed-vocabulary editor, and the execution log. Markup only; the model
   judges and the App handlers write.
   ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const S = () => (ns.State ? ns.State.getState() : null);
  const U = ns.Utils;
  const $ = U.$;
  const esc = U.escapeHtml;

  // One flat field list for the editor. The model refuses a field the chosen
  // record type does not expose, so a wrong pick is a toast, not a write.
  const FIELD_LABEL = {
    status: 'status',
    title: 'title',
    requester: 'requester',
    costImpact: 'cost impact',
    schedImpact: 'schedule impact',
    notes: 'notes',
    approvedBy: 'approved by',
    description: 'description',
    owner: 'owner',
    targetDate: 'target date',
    probability: 'probability',
    impact: 'impact',
    score: 'score (probability x impact)',
    mitigation: 'mitigation'
  };
  const KIND_LABEL = { change: 'Change', issue: 'Issue', risk: 'Risk' };
  const EVENT_LABEL = {
    created: 'was created',
    status: 'changed status',
    field: 'changed a field',
    deleted: 'was deleted'
  };
  const ACTION_LABEL = {
    setField: 'Set a field',
    appendLog: 'Append a log entry',
    raiseIssue: 'Raise an issue',
    requireApproval: 'Require a second approver',
    notify: 'Show a message'
  };
  const OP_LABEL = {
    is: 'is',
    isNot: 'is not',
    gt: 'is more than',
    lt: 'is less than',
    contains: 'contains'
  };

  function opts(list, label, selected) {
    return list
      .map(function (k) {
        const v = typeof k === 'string' ? k : k.key;
        const l = typeof k === 'string' ? label[k] || k : k.label;
        return (
          '<option value="' +
          esc(v) +
          '"' +
          (String(selected) === String(v) ? ' selected' : '') +
          '>' +
          esc(l) +
          '</option>'
        );
      })
      .join('');
  }

  function ruleRow(rule) {
    const trig = rule.trigger || {};
    const act = rule.action || {};
    return (
      '<div class="ru-row' +
      (rule.enabled === true ? '' : ' is-off') +
      '">' +
      '<label class="ru-on" title="Enable or disable this rule">' +
      '<input type="checkbox" data-action="tglRule" data-id="' +
      esc(rule.id) +
      '"' +
      (rule.enabled === true ? ' checked' : '') +
      ' aria-label="Enable ' +
      esc(rule.name || 'rule') +
      '">' +
      '</label>' +
      '<span class="ru-name">' +
      esc(rule.name || 'Untitled rule') +
      '</span>' +
      '<span class="ru-trig">' +
      esc(KIND_LABEL[trig.kind] || trig.kind || '?') +
      ' ' +
      esc(EVENT_LABEL[trig.event] || trig.event || '?') +
      '</span>' +
      '<span class="ru-act">' +
      esc(ACTION_LABEL[act.type] || act.type || '?') +
      '</span>' +
      (rule.hook === true ? '<span class="ru-hook-tag">hook</span>' : '') +
      '<button class="btn btn-s btn-d" data-action="delRule" data-id="' +
      esc(rule.id) +
      '" title="Delete this rule" aria-label="Delete ' +
      esc(rule.name || 'rule') +
      '">&times;</button>' +
      '</div>'
    );
  }

  function condRow(n) {
    return (
      '<div class="sr"><span class="sl">' +
      (n === 1 ? 'Where' : 'And') +
      '</span>' +
      '<select id="rule-c' +
      n +
      '-field" class="ctl-in" aria-label="Condition ' +
      n +
      ' field">' +
      '<option value="">Any record</option>' +
      opts(Object.keys(FIELD_LABEL), FIELD_LABEL, '') +
      '</select>' +
      '<select id="rule-c' +
      n +
      '-op" class="ctl-in" aria-label="Condition ' +
      n +
      ' comparison">' +
      opts(Object.keys(OP_LABEL), OP_LABEL, 'is') +
      '</select>' +
      '<input id="rule-c' +
      n +
      '-val" class="ctl-in w150" type="text" placeholder="' +
      (n === 1 ? 'value' : 'optional second condition') +
      '" aria-label="Condition ' +
      n +
      ' value">' +
      '</div>'
    );
  }

  function renderRules() {
    const host = $('rules-body');
    if (!host) {
      return;
    }
    const s = S();
    const rules = (s && s.rules) || [];
    const list = rules.length
      ? rules.map(ruleRow).join('')
      : '<div class="es es-row">No rules yet. A rule is a declared trigger, a condition and one action from a fixed list.</div>';
    host.innerHTML =
      '<div class="ru-list">' +
      list +
      '</div>' +
      '<div class="ru-form">' +
      '<div class="sr"><span class="sl">Name</span>' +
      '<input id="rule-name" class="ctl-in" type="text" placeholder="Raise an issue on a high risk" aria-label="Rule name"></div>' +
      '<div class="sr"><span class="sl">When</span>' +
      '<select id="rule-kind" class="ctl-in" aria-label="Rule record type">' +
      opts(Object.keys(KIND_LABEL), KIND_LABEL, 'change') +
      '</select>' +
      '<select id="rule-event" class="ctl-in" aria-label="Rule event">' +
      opts(Object.keys(EVENT_LABEL), EVENT_LABEL, 'status') +
      '</select></div>' +
      condRow(1) +
      condRow(2) +
      '<div class="sr"><span class="sl">Then</span>' +
      '<select id="rule-act" class="ctl-in" aria-label="Rule action">' +
      opts(Object.keys(ACTION_LABEL), ACTION_LABEL, 'appendLog') +
      '</select>' +
      '<select id="rule-act-field" class="ctl-in" aria-label="Action field">' +
      '<option value="">(no field)</option>' +
      opts(Object.keys(FIELD_LABEL), FIELD_LABEL, '') +
      '</select></div>' +
      '<div class="sr"><span class="sl">Value</span>' +
      '<input id="rule-act-val" class="ctl-in w150" type="text" placeholder="value to set" aria-label="Action value">' +
      '<input id="rule-act-text" class="ctl-in" type="text" placeholder="text for a log entry, issue or message" aria-label="Action text"></div>' +
      '<div class="sr-hint">No scripting and no outside calls. {ref} and {title} in the text are filled from the record.</div>' +
      '<div class="sr"><span class="sl">Send</span>' +
      '<label class="ru-hook"><input type="checkbox" id="rule-hook"> Also POST each status move this rule judges to the project\u2019s transition webhook (owner code required)</label></div>' +
      '<div class="sr"><span class="sl"></span>' +
      '<button class="btn btn-g btn-s" data-action="addRule">Add rule</button></div>' +
      '</div>' +
      '<div class="ru-log"><div class="ru-log-h">Execution log</div><div id="rule-log-body"></div></div>';
    renderRuleLog(s);
  }

  function renderRuleLog(s) {
    const host = $('rule-log-body');
    if (!host) {
      return;
    }
    const rows = ((s && s.ruleLog) || []).slice().reverse().slice(0, 20);
    if (!rows.length) {
      host.innerHTML = '<div class="ru-none">Nothing has fired yet.</div>';
      return;
    }
    host.innerHTML = rows
      .map(
        r =>
          '<div class="ru-lr' +
          (r.result === 'refused' ? ' is-refused' : '') +
          '">' +
          '<span class="ru-lt">' +
          esc(new Date(r.at).toLocaleString()) +
          '</span>' +
          '<span class="ru-ln">' +
          esc(r.name || 'Untitled rule') +
          '</span>' +
          '<span class="ru-lk">' +
          esc(KIND_LABEL[r.kind] || r.kind || '') +
          ' ' +
          esc(r.ref || '') +
          '</span>' +
          '<span class="ru-lr-res">' +
          esc(r.result) +
          '</span>' +
          (r.note ? '<span class="ru-lnote">' + esc(r.note) + '</span>' : '') +
          '</div>'
      )
      .join('');
  }

  ns.RenderProcess = { renderRules: renderRules };
})(MMGR);
window.MMGR = MMGR;
