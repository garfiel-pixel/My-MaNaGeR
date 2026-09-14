/* ============================================================
   CONTACT - public contact-form endpoint (no session required)
   ------------------------------------------------------------
   Owner decision 2026-09-14: the contact form posts here and
   the message lands in the admin inbox that is already printed
   on the contact page. Email is REQUIRED (it is the reply-to);
   name stays optional. Rate limited 5 per 30 min per IP.
   ============================================================ */
import { json, cloudRateCheck, sendAuthEmail } from './lib/http.js';

const CONTACT_TO = 'admin@mymanagerworkspace.com';
const CONTACT_EMAIL_MAX = 120;
const CONTACT_NAME_MAX = 60;
const CONTACT_TOPIC_MAX = 40;
const CONTACT_MESSAGE_MAX = 2000;
const CONTACT_TOPICS = ['Access code', 'Support', 'Feature idea', 'Other'];

function contactPlainProblem(s) {
  if (s && /[<>]/.test(s)) return 'plain text only - no HTML or markup';
  return null;
}

export async function handleContactCreate(request, env) {
  const r = await cloudRateCheck(request, 'contact', env);
  if (r.limited) return json({ ok: false, error: 'too many messages - try again in a bit' }, 429);
  let body = null;
  try { body = await request.json(); } catch (e) { body = null; }
  if (!body || typeof body !== 'object') return json({ ok: false, error: 'bad request' }, 400);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, CONTACT_NAME_MAX) : '';
  const email = typeof body.email === 'string' ? body.email.trim().slice(0, CONTACT_EMAIL_MAX) : '';
  let topic = typeof body.topic === 'string' ? body.topic.trim().slice(0, CONTACT_TOPIC_MAX) : 'Other';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!email) return json({ ok: false, error: 'your email is required so we can reply' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: 'that email address does not look right' }, 400);
  if (!message) return json({ ok: false, error: 'a message is required' }, 400);
  if (message.length > CONTACT_MESSAGE_MAX) return json({ ok: false, error: 'message too long (max ' + CONTACT_MESSAGE_MAX + ' characters)' }, 400);
  const prob = contactPlainProblem(name) || contactPlainProblem(topic) || contactPlainProblem(message);
  if (prob) return json({ ok: false, error: prob }, 400);
  if (!CONTACT_TOPICS.some(function (t) { return t.toLowerCase() === topic.toLowerCase(); })) topic = 'Other';

  const subject = 'My MaNaGeR contact: ' + topic;
  const text = 'Topic: ' + topic + '\n\n' + message + '\n\nReply to: ' + email + (name ? ' (' + name + ')' : '') + '\n';

  const configured = !!(env && typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY);
  let sent = false;
  if (configured) {
    try { sent = await sendAuthEmail(env, CONTACT_TO, subject, text); } catch (e) { sent = false; }
  }
  if (!sent) {
    return json({ ok: false, error: 'could not send right now - please email ' + CONTACT_TO + ' directly' }, 502);
  }
  return json({ ok: true, sent: true });
}
