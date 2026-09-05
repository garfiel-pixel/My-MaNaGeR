/* ============================================================
   My MaNaGeR - Copy / Export Text Builders
   Section-specific copy, multi-format digests, email templates,
   and live previews for the Controls tab.
   Extracted from mmgr-app.js.
   ============================================================ */
var MMGR = window.MMGR || {};

(function(ns) {
  'use strict';

  const U = ns.Utils;
  function _toast(msg, type) { if (ns.App && ns.App.showToast) ns.App.showToast(msg, type); }

  function _fmtMoney(n) { return '$' + Number(n || 0).toLocaleString(); }

  // ---- Copy All ----
  // Section-specific formatted blocks for the ported sections (RACI, Comms,
  // Docs, Meetings) match the monolith's exports; everything else falls
  // back to the generic table-dump.
  function cpAllPage(section) {
    const s = ns.State.getState();
    const ts = '[Copied: ' + new Date().toLocaleString() + ' | My MaNaGeR | ' + ((s && s.methodology) || '').toUpperCase() + ']';
    var text = ts + '\n\n';
    if (section === 'raci' && ns.Raci && ns.Raci.raciExportBlock) {
      text += 'RACI MATRIX\n' + '='.repeat(40) + '\n' + ns.Raci.raciExportBlock();
      U.copyToClipboard(text);
      _toast('Copied!', 'ok');
      return;
    }
    if (section === 'comms') {
      text += 'COMMUNICATION LOG\n' + '='.repeat(40) + '\n';
      ((s && s.commsEntries) || []).forEach(function(c) {
        text += '[' + c.id + '] ' + c.date + ' | ' + c.type + ' | ' + c.attendees + '\n  Summary: ' + c.summary + '\n  Actions: ' + c.actionItems + '\n  Follow-up: ' + (c.followUp || '-') + '\n\n';
      });
      U.copyToClipboard(text);
      _toast('Copied!', 'ok');
      return;
    }
    if (section === 'docs') {
      text += 'DOCUMENT REGISTER\n' + '='.repeat(40) + '\n';
      ((s && s.documents) || []).forEach(function(d) {
        text += '[' + d.id + '] ' + d.docNo + ' | ' + d.title + ' | ' + d.type + ' v' + d.version + ' | ' + d.status + ' | ' + d.responsible + ' | Issued: ' + (d.dateIssued || '-') + ' | ' + (d.notes || '') + '\n';
      });
      U.copyToClipboard(text);
      _toast('Copied!', 'ok');
      return;
    }
    if (section === 'wxlog') {
      text += 'WEATHER DELAY LOG (DISPUTE RECORD)\n' + '='.repeat(40) + '\n';
      var log = (s && s.weatherLog) || [];
      if (log.length) {
        log.forEach(function(e) {
          text += e.date + ' | ' + (e.condition || '-') + (e.note ? ' | Note: ' + e.note : '') +
            (e.affectedTaskIds && e.affectedTaskIds.length ? ' | Affected: ' + e.affectedTaskIds.join(', ') : '') + '\n';
        });
      } else {
        text += 'No weather delay days logged yet.\n';
      }
      if (ns.Forecast && ns.Forecast.ldExposure) {
        var ld = ns.Forecast.ldExposure(s);
        text += '\nLD EXPOSURE\n' + '-'.repeat(30) + '\n' +
          'Logged days: ' + ld.days + ' | LD rate: $' + Number(ld.rate).toLocaleString() + '/day | Exposure: $' + Number(ld.exposure).toLocaleString() + '\n';
      }
      U.copyToClipboard(text);
      _toast('Weather log copied!', 'ok');
      return;
    }
    if (section === 'meet' && ns.Meetings) {
      var M = ns.Meetings;
      text += 'MEETING AGENDAS & TEMPLATES\n' + '='.repeat(40) + '\n\nPRE-PROJECT KICKOFF (' + M.MEET_TEMPLATES.kickoff.dur + ')\n' + '-'.repeat(30) + '\n';
      M.MEET_KICKOFF_ITEMS.forEach(function(it, i) { text += (i + 1) + '. ' + it + '\n'; });
      text += '\nRECURRING TEMPLATES\n' + '-'.repeat(30) + '\n';
      M.MEET_RECURRING.concat(M.MEET_SPECIALIZED).forEach(function(m) { text += '\u2022 ' + m.t + ' (' + m.dur + ') , ' + m.d + '\n'; });
      if (s && (s.methodology === 'agile' || s.methodology === 'hybrid')) {
        text += '\nAGILE CEREMONIES\n' + '-'.repeat(30) + '\n';
        M.MEET_AGILE.forEach(function(m) { text += '\u2022 ' + m.t + ' (' + m.dur + ') , ' + m.d + '\n'; });
      }
      U.copyToClipboard(text);
      _toast('All meeting templates copied!', 'ok');
      return;
    }
    if (section === 'baselinen') {
      text += 'WHAT CHANGED THIS WEEK\n' + '='.repeat(40) + '\n';
      var narr = ns.Render && ns.Render.computeBaselineNarrative ? ns.Render.computeBaselineNarrative(s) : null;
      if (narr) {
        narr.forEach(function(n) { text += '\u2022 ' + n + '\n'; });
      } else {
        text += 'No baseline captured yet , Settings > Controls > Save Baseline.\n';
      }
      text += '\nCURRENT PLAN (tasks)\n' + '='.repeat(40) + '\n';
      (Array.isArray(s && s.tasks) ? s.tasks : []).forEach(function(t) {
        text += '[' + t.id + '] ' + t.name + ' | ' + (t.status || '') + ' | ' + (t.startDate || '-') + ' \u2192 ' + (t.endDate || '-') + '\n';
      });
      U.copyToClipboard(text);
      _toast('Copied!', 'ok');
      return;
    }
    if (section === 'claim' && ns.Claim) {
      var fromEl = U.$('claim-from');
      var toEl = U.$('claim-to');
      var pack = ns.Claim.buildClaimPack(s, fromEl ? fromEl.value : '', toEl ? toEl.value : '');
      text += ns.Claim.claimPackText(pack);
      U.copyToClipboard(text);
      _toast('Claim pack copied!', 'ok');
      return;
    }
    if (section === 'digest' && ns.Digest && ns.Digest.computeDigest && ns.Digest.buildDigestText) {
      text += ns.Digest.buildDigestText(ns.Digest.computeDigest(s));
      U.copyToClipboard(text);
      _toast('Digest copied!', 'ok');
      return;
    }
    var body = U.$(section + '-body');
    if (!body) return;
    text = Array.from(body.querySelectorAll('tr')).map(function(tr) {
      return Array.from(tr.querySelectorAll('td,th')).map(function(td) { return td.textContent.trim(); }).join(' | ');
    }).join('\n');
    U.copyToClipboard(text);
    _toast('Copied!', 'ok');
  }

  // ---- Multi-format Copy All ----
  function buildDigest(s) {
    var lines = [];
    var f = (s.charter) || {};
    lines.push('*' + (s.projectName || f.name || 'Project') + '*');
    lines.push('Status: ' + (f.status || '-') + ' | Methodology: ' + ((s.methodology || 'waterfall').toUpperCase()));
    var tasks = Array.isArray(s.tasks) ? s.tasks : [];
    var done = tasks.filter(function(t) { return t.status === 'completed'; }).length;
    var overdue = tasks.filter(function(t) { return U.isOverdue(t.endDate) && t.status !== 'completed'; }).length;
    lines.push('Tasks: ' + done + '/' + tasks.length + ' complete' + (overdue ? ' | *' + overdue + ' overdue*' : ''));
    if (f.targetCompletion) {
      var t = ns.Render && ns.Render.computeTimelineStatus ? ns.Render.computeTimelineStatus(s) : null;
      if (t) lines.push('Timeline: ' + t.status + (t.overrunDays > 0 ? ' (+' + t.overrunDays + 'd)' : ''));
    }
    var risks = (Array.isArray(s.risks) ? s.risks : []).filter(function(r) { return !r.issueId && (r.probability === 'High' || r.probability === 'high'); });
    if (risks.length) lines.push('High risks: ' + risks.map(function(r) { return r.description; }).join('; '));
    var issues = (Array.isArray(s.issues) ? s.issues : []).filter(function(i) { return i.status !== 'resolved' && i.status !== 'closed'; });
    if (issues.length) lines.push('Open issues: ' + issues.map(function(i) { return i.description; }).join('; '));
    var planned = (Array.isArray(s.budgetLines) ? s.budgetLines : []).reduce(function(n, l) { return n + (+l.planned || 0); }, 0);
    var actual = (Array.isArray(s.budgetLines) ? s.budgetLines : []).reduce(function(n, l) { return n + (+l.actual || 0); }, 0);
    lines.push('Budget: ' + _fmtMoney(actual) + ' spent of ' + _fmtMoney(planned) + ' planned' + (planned > actual ? '' : ' | *over planned*'));
    if (ns.Render && ns.Render.computeAgingActions) {
      var open = ns.Render.computeAgingActions(s).filter(function(a) { return (a.age || 0) > 0; }).length;
      if (open) lines.push('Action items past due: ' + open);
    }
    return lines.join('\n');
  }

  function copyAsText(kind) {
    var s = ns.State.getState();
    var ts = new Date().toLocaleString();
    if (kind === 'slack') {
      return '*My MaNaGeR , Weekly Digest* (' + ts + ')\n' + buildDigest(s);
    } else if (kind === 'email') {
      var body = buildDigest(s).replace(/\*/g, '');
      return 'Subject: Project Digest , ' + (s.projectName || '') + '\n\nHi team,\n\n' + body.replace(/\n/g, '\n') + '\n\n, My MaNaGeR\n';
    } else if (kind === 'client') {
      var f = (s.charter) || {};
      var tasks = Array.isArray(s.tasks) ? s.tasks : [];
      var done = tasks.filter(function(t) { return t.status === 'completed'; }).length;
      var lines = [];
      lines.push('CLIENT PROJECT SUMMARY');
      lines.push('='.repeat(40));
      lines.push('Project: ' + (s.projectName || f.name || '-'));
      lines.push('Status: ' + (f.status || '-'));
      lines.push('Prepared: ' + ts);
      lines.push('');
      lines.push('PROGRESS');
      lines.push('-'.repeat(30));
      lines.push('Completion: ' + (tasks.length ? Math.round(done / tasks.length * 100) : 0) + '% (' + done + ' of ' + tasks.length + ' tasks)');
      if (f.targetCompletion) lines.push('Target completion: ' + f.targetCompletion);
      lines.push('');
      lines.push('KEY METRICS');
      lines.push('-'.repeat(30));
      var planned = (Array.isArray(s.budgetLines) ? s.budgetLines : []).reduce(function(n, l) { return n + (+l.planned || 0); }, 0);
      var actual = (Array.isArray(s.budgetLines) ? s.budgetLines : []).reduce(function(n, l) { return n + (+l.actual || 0); }, 0);
      lines.push('Budget: ' + _fmtMoney(actual) + ' spent / ' + _fmtMoney(planned) + ' planned');
      lines.push('Open issues: ' + (Array.isArray(s.issues) ? s.issues : []).filter(function(i) { return i.status !== 'resolved' && i.status !== 'closed'; }).length);
      lines.push('Open high risks: ' + (Array.isArray(s.risks) ? s.risks : []).filter(function(r) { return !r.issueId && (r.probability === 'High' || r.probability === 'high'); }).length);
      lines.push('');
      lines.push('GENERATED BY MY MANAGER');
      return lines.join('\n');
    }
    return '';
  }

  function renderCtrlPreviews() {
    var set = function(id, txt) {
      var el = U.$(id);
      if (el) el.textContent = txt || '';
    };
    set('pv-slack', copyAsText('slack'));
    set('pv-email', copyAsText('email'));
    set('pv-client', copyAsText('client'));
    set('pv-tpl-status', emailTplText('status'));
    set('pv-tpl-change', emailTplText('change'));
    set('pv-tpl-risk', emailTplText('risk'));
    set('pv-tpl-closure', emailTplText('closure'));
  }

  function cpFormats(kind) {
    var txt = copyAsText(kind);
    if (!txt) { _toast('Nothing to copy yet.', 'warn'); return; }
    U.copyToClipboard(txt);
    var label = kind === 'slack' ? 'Slack digest' : (kind === 'email' ? 'Email digest' : 'Client summary');
    _toast(label + ' copied!', 'ok');
  }

  // ---- Email template generator ----
  function emailTplText(kind) {
    var s = ns.State.getState();
    var f = s.charter || {};
    var pn = f.name || '[Project Name]';
    var pm = '[PM]';
    var sp = f.sponsor || '[Sponsor]';
    var tasks = Array.isArray(s.tasks) ? s.tasks : [];
    var tot = tasks.length;
    var dn = tasks.filter(function(t) { return t.status === 'completed'; }).length;
    var pct = tot ? Math.round(dn / tot * 100) : 0;
    var openIssues = (Array.isArray(s.issues) ? s.issues : []).filter(function(i) { return i.status !== 'resolved' && i.status !== 'closed'; });
    var body = '';
    if (kind === 'status') {
      body = 'Subject: ' + pn + ' , Weekly Status Update\n\nHi ' + sp + ',\n\nQuick status on ' + pn + ' as of ' + new Date().toLocaleDateString() + ':\n\u2022 Overall progress: ' + pct + '% Completed (' + dn + '/' + tot + ' tasks)\n\u2022 In Progress: ' + tasks.filter(function(t) { return t.status === 'inprogress'; }).length + '\n\u2022 Blocked: ' + tasks.filter(function(t) { return t.status === 'blocked'; }).length + '\n\u2022 Live issues: ' + openIssues.length + '\n\nNext priorities:\n' + (tasks.filter(function(t) { return t.status !== 'completed'; }).slice(0, 3).map(function(t) { return '  - ' + (t.name || t.id); }).join('\n') || '  - (none)') + '\n\nRegards,\n' + pm;
    } else if (kind === 'change') {
      var pending = (Array.isArray(s.changes) ? s.changes : []).filter(function(c) { return c.status === 'submitted' || c.status === 'review'; });
      body = 'Subject: ' + pn + ' , Change Request for Approval\n\nHi ' + sp + ',\n\nA change request has been raised on ' + pn + '. Please review the impact below and confirm approval:\n\n' + (pending.map(function(c) { return '\u2022 ' + (c.title || '(untitled)') + ' (Sched ' + (c.schedImpact || '-') + ', Cost ' + (c.costImpact || '-') + ') , Requester: ' + (c.requester || '-') + '\n  Notes: ' + (c.notes || ''); }).join('\n') || '(no pending changes)') + '\n\nAwaiting your decision.\n\nRegards,\n' + pm;
    } else if (kind === 'risk') {
      var highRisks = (Array.isArray(s.risks) ? s.risks : []).filter(function(r) { return !r.issueId && (r.probability === 'High' || r.probability === 'Very High' || r.impact === 'High' || r.impact === 'Very High'); });
      body = 'Subject: ' + pn + ' , Risk / Issue Escalation\n\nHi ' + sp + ',\n\nThe following items require attention on ' + pn + ':\n\nACTIVE ISSUES:\n' + (openIssues.map(function(r) { return '\u2022 [' + (r.id || 'I?') + '] ' + r.description + ' | Owner: ' + (r.owner || '-') + ' | Target: ' + (r.targetDate || '-'); }).join('\n') || '(none)') + '\n\nHIGH RISKS:\n' + (highRisks.map(function(r) { return '\u2022 [' + (r.id || 'R?') + '] ' + r.description + ' | Prob ' + r.probability + ' | Impact ' + r.impact + ' | Mitigation: ' + (r.mitigation || '-'); }).join('\n') || '(none)') + '\n\nRegards,\n' + pm;
    } else {
      var items = (s.closure && s.closure.items) || [];
      body = 'Subject: ' + pn + ' , Closure Sign-Off Request\n\nHi ' + sp + ',\n\n' + pn + ' is ready for formal closure. Summary:\n\u2022 Overall: ' + pct + '% Completed\n\u2022 Deliverables checklist: ' + items.filter(function(c) { return c.done; }).length + '/' + items.length + ' complete\n\nLessons learned and final report attached. Please confirm sign-off.\n\nRegards,\n' + pm;
    }
    return body;
  }

  function emailTpl(kind) {
    U.copyToClipboard(emailTplText(kind));
    _toast('Email template copied!', 'ok');
  }

  ns.AppCopy = {
    cpAllPage: cpAllPage,
    buildDigest: buildDigest,
    copyAsText: copyAsText,
    renderCtrlPreviews: renderCtrlPreviews,
    cpFormats: cpFormats,
    emailTplText: emailTplText,
    emailTpl: emailTpl
  };
})(MMGR);
window.MMGR = MMGR;
