// PayPilot: AI turns a plain-English job request into a scheduled booking + PayPal (sandbox) order.
import express from 'express';
const app = express(); app.use(express.json()); app.use(express.static('public'));
const PP = 'https://api-m.sandbox.paypal.com';
const bookings = [];
export function parseRequest(text) { // rule-based fallback; swap in LLM via OPENAI_API_KEY
  const amt = (text.match(/\$(\d+(?:\.\d{1,2})?)/) || text.match(/(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars)/i) || [])[1] || '50';
  const hrs = (text.match(/(\d+)\s*(?:h|hour)/i) || [])[1] || '1';
  const day = (text.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/i) || [])[1] || 'tomorrow';
  return { service: text.slice(0, 60), amount: Number(amt).toFixed(2), hours: Number(hrs), day: day.toLowerCase() };
}
async function llmParse(text) {
  if (!process.env.OPENAI_API_KEY) return parseRequest(text);
  const r = await fetch((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: 'Extract JSON {service,amount,hours,day} from a job booking request. amount as string USD.' }, { role: 'user', content: text }] }) });
  try { return JSON.parse((await r.json()).choices[0].message.content); } catch { return parseRequest(text); }
}
async function ppToken() {
  const id = process.env.PAYPAL_CLIENT_ID, sec = process.env.PAYPAL_CLIENT_SECRET; if (!id || !sec) return null;
  const r = await fetch(PP + '/v1/oauth2/token', { method: 'POST', body: 'grant_type=client_credentials',
    headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + sec).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' } });
  return (await r.json()).access_token;
}
async function createOrder(b) {
  const t = await ppToken(); if (!t) return { id: 'MOCK-' + Date.now(), status: 'CREATED (mock: set PAYPAL_CLIENT_ID/SECRET)' };
  const r = await fetch(PP + '/v2/checkout/orders', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ description: b.service, amount: { currency_code: 'USD', value: b.amount } }] }) });
  const j = await r.json(); return { id: j.id, status: j.status, approve: (j.links || []).find(l => l.rel === 'approve')?.href };
}
app.post('/api/book', async (req, res) => { const b = await llmParse(req.body.text || ''); b.order = await createOrder(b); b.id = bookings.length + 1; bookings.push(b); res.json(b); });
app.get('/api/bookings', (_q, res) => res.json(bookings));
if (process.argv[1].endsWith('server.js')) app.listen(process.env.PORT || 3000, () => console.log('PayPilot on :' + (process.env.PORT || 3000)));
