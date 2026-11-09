/* ============================================================
 My MaNaGeR, Cloud Webhooks
 Owner-only webhook CRUD (health drop, weather risk).
 Extracted from mmgr-cloud.js.
 ============================================================ */
var MMGR = window.MMGR || {};

(function (ns) {
  'use strict';

  const C = ns.Cloud;
  const $ = function (id) {
    return document.getElementById(id);
  };
  function pid() {
    return C._pid();
  }
  function esc(v) {
    return C._esc(v);
  }
  function getCode() {
    return C.getCode();
  }
  function setStatus(msg, kind) {
    C._setStatus(msg, kind);
  }

  async function webhookList() {
    const wrap = $('cloud-webhook-list');
    if (!wrap) {
      return;
    }
    const code = getCode();
    if (!code) {
      wrap.innerHTML = '<div class="sr-hint">Owner code required.</div>';
      return;
    }
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { 'X-Owner-Code': code }
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        wrap.innerHTML = '<div class="sr-hint">Could not load webhooks.</div>';
        return;
      }
      const list = data.webhooks || [];
      if (!list.length) {
        wrap.innerHTML =
          '<div class="sr-hint">No webhooks yet - add one above (health drop, weather risk or status move).</div>';
        return;
      }
      const EVENT_LABEL = {
        health_dropped: 'Health score dropped',
        weather_risk_tomorrow: 'Weather-risk day tomorrow',
        transition_recorded: 'Status move recorded'
      };
      wrap.innerHTML = list
        .map(function (w) {
          const label = EVENT_LABEL[w.event] || w.event;
          return (
            '<div class="sr" style="border:1px solid var(--border);border-radius:var(--radius);padding:7px 10px;margin:4px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
            '<span class="sl" style="font-size:.68rem">' +
            esc(label) +
            '</span>' +
            '<code style="font-size:.66rem;color:var(--slate);word-break:break-all">' +
            esc(w.targetUrl) +
            '</code>' +
            '<span class="sr-hint" style="margin:0 0 0 auto;font-size:.6rem">' +
            (w.lastFiredAt
              ? 'last fired ' + esc(String(w.lastFiredAt).slice(0, 10))
              : 'never fired') +
            '</span>' +
            '<button class="btn btn-o btn-s" data-action="cloudWebhookDel" data-id="' +
            esc(w.id) +
            '"><svg class="ico" aria-hidden="true"><use href="css/mmgr-icons.svg#i-x"></use></svg> Remove</button>' +
            '</div>'
          );
        })
        .join('');
    } catch (e) {
      wrap.innerHTML = '<div class="sr-hint">Could not reach the cloud service.</div>';
    }
  }

  async function webhookAdd() {
    const code = getCode();
    if (!code) {
      setStatus('Owner code required.', 'warn');
      return;
    }
    const event = $('cloud-webhook-event');
    const urlEl = $('cloud-webhook-url');
    const targetUrl = urlEl ? urlEl.value.trim() : '';
    if (!targetUrl) {
      setStatus('Enter a target URL for the webhook.', 'warn');
      return;
    }
    setStatus('Adding webhook\u2026', 'busy');
    try {
      const res = await fetch('/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
        body: JSON.stringify({
          event: event ? event.value : 'health_dropped',
          targetUrl: targetUrl
        })
      });
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        setStatus((data && data.error) || 'Add webhook failed (HTTP ' + res.status + ').', 'err');
        return;
      }
      if (urlEl) {
        urlEl.value = '';
      }
      setStatus('Webhook added. Signing secret (shown once, store it): ' + data.secret, 'ok');
      webhookList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  async function webhookDel(id) {
    const code = getCode();
    if (!code) {
      setStatus('Owner code required.', 'warn');
      return;
    }
    try {
      const res = await fetch(
        '/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks/' + encodeURIComponent(id),
        {
          method: 'DELETE',
          credentials: 'same-origin',
          headers: { 'X-Owner-Code': code }
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        setStatus(
          (data && data.error) || 'Remove webhook failed (HTTP ' + res.status + ').',
          'err'
        );
        return;
      }
      setStatus('Webhook removed.', 'ok');
      webhookList();
    } catch (e) {
      setStatus('Cloud is unavailable on this host (needs the Worker API).', 'err');
    }
  }

  // A transition summary is a small document a rule asked to send after a
  // successful move. The Worker relays it to the project's
  // "transition_recorded" subscriptions, signing each delivery with the same
  // subscription secret as every other webhook. Owner code required, and no
  // rule sends unless its hook box was ticked.
  async function sendTransitionSummary(summary, ruleName) {
    const label = String(ruleName || 'A rule');
    const code = getCode();
    if (!code) {
      if (ns.App && ns.App.showToast) {
        ns.App.showToast(label + ' could not send: the owner code is needed.', 'err');
      }
      return false;
    }
    try {
      const res = await fetch(
        '/api/cloud/projects/' + encodeURIComponent(pid()) + '/webhooks/notify',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-Owner-Code': code },
          body: JSON.stringify({ payload: summary })
        }
      );
      const data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        if (ns.App && ns.App.showToast) {
          ns.App.showToast(
            label + ' could not send: ' + ((data && data.error) || 'HTTP ' + res.status),
            'err'
          );
        }
        return false;
      }
      if (ns.App && ns.App.showToast) {
        ns.App.showToast(
          data.delivered
            ? label + ' sent ' + String(summary.ref || 'the move') + ' to the webhook.'
            : label + ' found no transition webhook to send to.',
          data.delivered ? 'ok' : 'warn'
        );
      }
      return true;
    } catch (e) {
      if (ns.App && ns.App.showToast) {
        ns.App.showToast(label + ' could not reach the cloud service.', 'err');
      }
      return false;
    }
  }

  ns.CloudWebhooks = {
    webhookList: webhookList,
    webhookAdd: webhookAdd,
    webhookDel: webhookDel,
    sendTransitionSummary: sendTransitionSummary
  };
})(MMGR);
window.MMGR = MMGR;
