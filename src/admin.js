/* ============================================================
   ADMIN , operator-gated cloud project listing
   ------------------------------------------------------------
   Extracted from worker.js. The admin endpoint lists ALL cloud
   projects with theme preferences surfaced per project.
   ============================================================ */
import { json, codesEqual, cloudDummyHash, cloudTimingSink, readJsonBody } from './lib/http.js';
import { billingProvider, billingStatusActive, paddleCancelSubscription } from './billing.js';

const CLOUD_PREFS_PREFIX = 'prefs/';
function cloudPrefsKey(sub) {
  return CLOUD_PREFS_PREFIX + sub + '.json';
}
function cloudSanitizePalette(v) {
  return v === 'cyan' || v === 'default' ? v : null;
}

export async function cloudAdminAuth(request, env) {
  const expected = env && typeof env.ADMIN_CODE === 'string' ? env.ADMIN_CODE.trim() : '';
  if (!expected) {
    return { disabled: true };
  }
  const code = String(request.headers.get('X-Admin-Code') || '').trim();
  if (!code || !codesEqual(code, expected)) {
    await Promise.all([cloudDummyHash(), cloudTimingSink()]);
    return null;
  }
  return { ok: true };
}

/* ============================================================
   5.2 - ORPHANED SUBSCRIPTIONS (owner 2026-11-01, D2)
   ------------------------------------------------------------
   Deleting an account in the app cancels at Paddle and removes the row, but a
   hand-edited D1 row can outlive its account and keep granting a paid tier to
   nobody while Paddle keeps charging it. That is the billable ghost: nobody can
   see it, so nobody can cancel it.

   Two routes, both behind the SAME site admin code as the project list:
     GET  /api/admin/billing/subscriptions   list rows and say which are ghosts
     POST /api/admin/billing/subscriptions/clear  cancel AT PADDLE, then clear

   The cancel is REQUIRED, not best-effort: if Paddle refuses, the row stays
   exactly where it is and the response carries the provider's reason. Clearing
   the row first would delete the only handle we have on a live charge.
   ============================================================ */

// An account counts as still present when ANYTHING in the app still holds it.
// Five independent proofs, each one enough:
//   - auth_users      : the address of a password/Google account (migration 0022)
//   - cloud_projects  : it owns or is linked to a project
//   - cloud_adoptions : it was given a project
//   - cloud_team_members: it is on someone's team
//   - auth_sessions   : it has a session that has not expired
// A session is deliberately LAST: sessions are short-lived credentials, not the
// account. They still count, because an account that was actually deleted has
// its sessions purged (src/auth/session.js) or they expire - so a live session
// stops a busy account ever being mistaken for a ghost.
//
// Every row reports WHY it was or was not called a ghost, so the operator sees
// the evidence instead of trusting a red badge.
async function accountPresence(env, ownerSub) {
  const sub = String(ownerSub || '');
  const proofs = [];
  if (sub.indexOf('email:') === 0) {
    try {
      const row = await env.DB.prepare('SELECT email FROM auth_users WHERE email = ?')
        .bind(sub.slice('email:'.length))
        .first();
      if (row) {
        proofs.push('account exists (auth_users)');
      }
    } catch (e) {
      /* ignore, absence is the point */
    }
  }
  const probes = [
    {
      sql: 'SELECT project_id FROM cloud_projects WHERE google_sub = ? LIMIT 1',
      why: 'owns a cloud project',
      binds: [sub]
    },
    {
      sql: 'SELECT project_id FROM cloud_adoptions WHERE recipient_sub = ? LIMIT 1',
      why: 'holds a shared project',
      binds: [sub]
    },
    {
      sql: 'SELECT id FROM cloud_team_members WHERE user_sub = ? LIMIT 1',
      why: 'is on a team',
      binds: [sub]
    },
    {
      sql: 'SELECT jti FROM auth_sessions WHERE sub = ? AND expires_at > ? LIMIT 1',
      why: 'has a live session',
      binds: [sub, new Date().toISOString()]
    }
  ];
  for (let i = 0; i < probes.length; i++) {
    try {
      const row = await env.DB.prepare(probes[i].sql)
        .bind(...probes[i].binds)
        .first();
      if (row) {
        proofs.push(probes[i].why);
      }
    } catch (e) {
      /* a table this deployment does not have cannot prove existence either */
    }
  }
  return proofs;
}

export async function handleAdminSubscriptionList(request, env) {
  const auth = await cloudAdminAuth(request, env);
  if (auth && auth.disabled) {
    return json({ ok: false, error: 'admin API not configured , set the ADMIN_CODE secret' }, 503);
  }
  if (!auth) {
    return json({ ok: false, error: 'invalid site admin code' }, 403);
  }
  const provider = billingProvider(env);
  const rows = await env.DB.prepare(
    'SELECT owner_sub, ls_subscription_id, status, plan, tier, current_period_end, updated_at FROM cloud_subscriptions ORDER BY updated_at DESC'
  ).all();
  const subscriptions = [];
  for (const r of rows.results || []) {
    const proofs = await accountPresence(env, r.owner_sub);
    const orphaned = proofs.length === 0;
    subscriptions.push({
      ownerSub: r.owner_sub,
      subscriptionId: r.ls_subscription_id || null,
      status: r.status,
      tier: r.tier || r.plan || null,
      currentPeriodEnd: r.current_period_end || null,
      updatedAt: r.updated_at || null,
      orphaned: orphaned,
      evidence: orphaned
        ? 'no account, project, sharing, team row or live session anywhere in the app'
        : proofs.join(', '),
      billable: billingStatusActive(r.status)
    });
  }
  return json({
    ok: true,
    provider: provider,
    cancellable: provider === 'paddle',
    subscriptions: subscriptions
  });
}

export async function handleAdminSubscriptionClear(request, env) {
  const auth = await cloudAdminAuth(request, env);
  if (auth && auth.disabled) {
    return json({ ok: false, error: 'admin API not configured , set the ADMIN_CODE secret' }, 503);
  }
  if (!auth) {
    return json({ ok: false, error: 'invalid site admin code' }, 403);
  }
  const read = await readJsonBody(request);
  const body = (read && read.body) || {};
  const ownerSub = String(body.ownerSub || '').trim();
  if (!ownerSub) {
    return json({ ok: false, error: 'ownerSub required', stage: 'request' }, 400);
  }
  const row = await env.DB.prepare(
    'SELECT owner_sub, ls_subscription_id, status FROM cloud_subscriptions WHERE owner_sub = ?'
  )
    .bind(ownerSub)
    .first();
  if (!row) {
    return json({ ok: false, error: 'no such subscription', stage: 'request' }, 404);
  }
  const proofs = await accountPresence(env, ownerSub);
  if (proofs.length) {
    return json(
      {
        ok: false,
        stage: 'orphan',
        error: 'not an orphan: ' + proofs.join(', '),
        evidence: proofs
      },
      409
    );
  }
  if (billingProvider(env) !== 'paddle') {
    return json(
      {
        ok: false,
        stage: 'provider',
        error:
          'no payment provider is configured, so nothing can be cancelled before the row is removed'
      },
      409
    );
  }
  const subId = String(row.ls_subscription_id || '');
  if (!subId) {
    return json(
      {
        ok: false,
        stage: 'cancel',
        error:
          'this row has no Paddle subscription id, so nothing can be cancelled. Clear it by hand in D1 and in the Paddle dashboard.'
      },
      409
    );
  }
  // THE CANCEL IS REQUIRED. Paddle is asked first and the row is only removed
  // once it answers. 404 counts as success (already gone, so nothing bills).
  const cancel = await paddleCancelSubscription(env, subId);
  if (!cancel.ok) {
    console.warn(
      'orphan cancel refused: ownerSub=' +
        ownerSub +
        ' subId=' +
        subId +
        ' http=' +
        (cancel.http || '')
    );
    return json(
      {
        ok: false,
        stage: 'cancel',
        error: cancel.error + (cancel.detail ? ': ' + cancel.detail : ''),
        http: cancel.http || null,
        keptRow: true
      },
      409
    );
  }
  const res = await env.DB.prepare('DELETE FROM cloud_subscriptions WHERE owner_sub = ?')
    .bind(ownerSub)
    .run();
  if (!res.meta || !res.meta.changes) {
    return json({ ok: false, stage: 'clear', error: 'the row could not be removed' }, 500);
  }
  console.log(
    'orphan subscription cleared: ownerSub=' +
      ownerSub +
      ' subId=' +
      subId +
      (cancel.alreadyGone ? ' (already cancelled at Paddle)' : ' (cancelled at Paddle)')
  );
  return json({
    ok: true,
    cleared: ownerSub,
    cancelledAtProvider: true,
    alreadyGone: !!cancel.alreadyGone
  });
}

export async function handleAdminCloudList(request, env) {
  const auth = await cloudAdminAuth(request, env);
  if (auth && auth.disabled) {
    return json({ ok: false, error: 'admin API not configured , set the ADMIN_CODE secret' }, 503);
  }
  if (!auth) {
    return json({ ok: false, error: 'invalid site admin code' }, 403);
  }
  const rows = await env.DB.prepare(
    'SELECT project_id, owner_label, google_name, google_sub, latest_r2_key, created_at, updated_at, deleted_at FROM cloud_projects ORDER BY updated_at DESC'
  ).all();
  const projects = [];
  for (const r of rows.results || []) {
    let themePrefs = null;
    if (r.google_sub) {
      try {
        const obj = await env.R2.get(cloudPrefsKey(r.google_sub));
        if (obj) {
          const p = JSON.parse(await obj.text());
          if (p) {
            themePrefs = {
              palette: cloudSanitizePalette(p.palette) || 'default',
              dark: !!p.dark,
              updatedAt: p.updatedAt || null
            };
          }
        }
      } catch (e) {
        themePrefs = null;
      }
    }
    projects.push({
      projectId: r.project_id,
      label: r.owner_label || null,
      linkedName: r.google_name || null,
      hasSnapshot: !!r.latest_r2_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at || null,
      themePrefs: themePrefs
    });
  }
  return json({ ok: true, projects: projects });
}
