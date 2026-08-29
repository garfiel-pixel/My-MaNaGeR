/* ============================================================
   REAL-TIME PRESENCE — Durable Object + WebSocket upgrade
   ------------------------------------------------------------
   Extracted from worker.js. One Presence DO per project tracks
   {id, name, since} per open WebSocket — never project content.
   OPT-IN, purely additive collaboration.
   ============================================================ */
import { json, cloudForbidden, cloudTimingSink, readSession, hashOwnerCode, codesEqual, cloudAuthEditor } from '../lib/http.js';

// ---- crypto + manifest check ---------------------------------------------

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

// Verify an access code against the PUBLISHED manifest (projects-data.js).
// Read through the ASSETS binding; any read/parse failure returns false.
export async function cloudManifestCodeOk(env, projectId, code) {
  try {
    const res = await env.ASSETS.fetch('/projects-data.js');
    if (!res.ok) return false;
    const text = await res.text();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return false;
    const projects = JSON.parse(text.slice(start, end + 1));
    const p = (projects || []).find(function(x) { return x && x.id === projectId; });
    if (!p) return false;
    const hash = await sha256Hex(String(code || '').trim().toUpperCase());
    return hash === p.codeHash || hash === (p.roCodeHash || p.readOnlyCodeHash || '');
  } catch (e) { return false; }
}

// ---- WebSocket upgrade handler -------------------------------------------

export async function handlePresenceUpgrade(request, env, url) {
  const projectId = String(url.searchParams.get('project') || '').slice(0, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) { await cloudTimingSink(); return cloudForbidden(); }
  let name = 'Viewer';
  let authed = false;
  // (a) Linked Google session — the cookie rides the handshake automatically.
  const session = await readSession(request, env);
  if (session && session.sub) {
    const row = await env.DB.prepare('SELECT google_sub FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
    if (row) {
      if (row.google_sub === session.sub) { authed = true; name = session.name || 'Owner'; }
      else { await cloudTimingSink(); return cloudForbidden(); }
    }
  }
  // (b) Code-based auth: owner code in URL query string.
  try {
    const isUpgrade = (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
    if (!authed && !isUpgrade) { await cloudTimingSink(); return cloudForbidden(); }
    if (!authed) {
      const code = String(url.searchParams.get('code') || '').trim();
      if (code) {
        const projRow = await env.DB.prepare('SELECT owner_code_hash, owner_code_salt FROM cloud_projects WHERE project_id = ?').bind(projectId).first();
        if (projRow) {
          const hash = await hashOwnerCode(code, projRow.owner_code_salt);
          if (codesEqual(hash, projRow.owner_code_hash)) { authed = true; name = 'Owner'; }
        }
      }
    }
    if (!authed) {
      const headers = new Headers(request.headers);
      headers.set('X-Presence-Name', encodeURIComponent(name));
      headers.set('X-Presence-Auth', 'required');
      headers.set('X-Presence-Project', projectId);
      const upgraded = new Request(request.url, { method: request.method, headers: headers });
      return await env.PRESENCE.get(env.PRESENCE.idFromName(projectId)).fetch(upgraded);
    }
    const headers = new Headers(request.headers);
    headers.set('X-Presence-Name', encodeURIComponent(name));
    const upgraded = new Request(request.url, { method: request.method, headers: headers });
    return await env.PRESENCE.get(env.PRESENCE.idFromName(projectId)).fetch(upgraded);
  } catch (e) {
    return json({ ok: false, error: 'presence not available' }, 503);
  }
}

// ---- rev-changed push (fire-and-forget from save path) --------------------

export async function presencePushRevChanged(env, projectId, revision) {
  try {
    const stub = env.PRESENCE.get(env.PRESENCE.idFromName(projectId));
    await stub.fetch(new Request('https://presence.internal/broadcast', {
      method: 'POST',
      body: JSON.stringify({ type: 'rev-changed', revision: revision })
    }));
  } catch (e) { /* presence is additive — a failed push changes nothing */ }
}

// ---- Presence Durable Object (WebSocket Collab, Hibernation API) ----------

export class Presence {
  constructor(state, env) { this.state = state; this.env = env; }

  async fetch(request) {
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      try {
        const msg = await request.text();
        if (msg) this.broadcast(msg);
      } catch (e) { /* ignore malformed internal calls */ }
      return new Response('ok');
    }
    const name = decodeURIComponent(request.headers.get('X-Presence-Name') || 'Viewer');
    const needsAuth = request.headers.get('X-Presence-Auth') === 'required';
    const authProject = request.headers.get('X-Presence-Project') || '';
    const pair = new WebSocketPair();
    const id = crypto.randomUUID();
    const server = pair[1];
    server.serializeAttachment({ id: id, name: name, since: Date.now(), lastSeen: Date.now(), authed: !needsAuth, authProject: authProject });
    this.state.acceptWebSocket(server);
    {
      const members = [];
      for (const ws of this.state.getWebSockets()) {
        const a = ws.deserializeAttachment();
        if (a && a.id !== id) members.push({ id: a.id, name: a.name, since: a.since });
      }
      server.send(JSON.stringify({ type: 'init', self: id, members: members }));
      this.broadcast(JSON.stringify({ type: 'join', id: id, name: name, since: Date.now() }), id);
    }
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, msg) {
    const now = Date.now();
    const att = ws.deserializeAttachment() || {};
    att.lastSeen = now;
    try {
      const data = JSON.parse(msg);
      if (data && data.type === 'auth' && !att.authed) {
        try {
          let res;
          try {
            res = await this.env.INTERNAL_AUTH.fetch('https://presence.internal/auth', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ projectId: att.authProject, code: data.code })
            });
          } catch (authErr) {
            ws.send(JSON.stringify({ type: 'auth_error' }));
            ws.close(4001, 'presence not available');
            return;
          }
          const r = await res.json();
          if (r.ok) {
            att.authed = true;
            att.name = r.name || att.name;
            ws.serializeAttachment(att);
            const members = [];
            for (const w of this.state.getWebSockets()) {
              const a = w.deserializeAttachment();
              if (a && a.authed && a.id !== att.id) members.push({ id: a.id, name: a.name, since: a.since });
            }
            ws.send(JSON.stringify({ type: 'init', self: att.id, members: members }));
            this.broadcast(JSON.stringify({ type: 'join', id: att.id, name: att.name, since: att.since }), att.id);
          } else {
            ws.send(JSON.stringify({ type: 'auth_error', error: 'invalid_code' }));
            try { ws.close(4001, 'auth failed'); } catch (e) { /* ignore */ }
          }
        } catch (e) {
          ws.send(JSON.stringify({ type: 'auth_error', error: 'auth_unavailable' }));
          try { ws.close(4001, 'auth unavailable'); } catch (e2) { /* ignore */ }
        }
        ws.serializeAttachment(att);
        return;
      }
      if (data && data.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); }
    } catch (e) { /* non-JSON frames are ignored */ }
    ws.serializeAttachment(att);
    for (const w of this.state.getWebSockets()) {
      const a = w.deserializeAttachment();
      if (a && now - (a.lastSeen || 0) > 75000) { try { w.close(4000, 'stale'); } catch (e2) { /* already gone */ } }
    }
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const a = ws.deserializeAttachment() || {};
    if (a && a.id) this.broadcast(JSON.stringify({ type: 'leave', id: a.id }), null);
  }

  async webSocketError(ws, err) {
    const a = ws.deserializeAttachment() || {};
    if (a && a.id) this.broadcast(JSON.stringify({ type: 'leave', id: a.id }), null);
  }

  broadcast(message, exceptId) {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || !a.authed) continue;
      if (exceptId && a.id === exceptId) continue;
      try { ws.send(message); } catch (e) { /* closing socket */ }
    }
  }
}
