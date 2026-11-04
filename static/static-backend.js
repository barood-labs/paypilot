// Static (serverless) demo backend for the hosted GitHub Pages demo.
// Runs the same rule-based parser (lib/parse.js) in the browser and answers the app's /api/* calls,
// with a mock PayPal order + capture loop. Mock mode only: no keys, no real money, state lives in localStorage.
import { parseRequest } from './lib/parse.js';
const KEY = 'paypilot-demo-v1';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { bookings: [], nextId: 1 }; } catch { return { bookings: [], nextId: 1 }; } };
let db = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
const p2 = n => String(n).padStart(2, '0');
const addHours = (date, start, hours) => { const d = new Date(`${date}T${start}:00`); d.setMinutes(d.getMinutes() + Math.round(hours * 60));
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00`; };
const isPaid = b => b.order?.status === 'COMPLETED';
const view = b => ({ ...b, paid: isPaid(b), startDate: `${b.date}T${b.start}:00`, endDate: addHours(b.date, b.start, b.hours) });
const find = id => db.bookings.find(b => b.id === Number(id));
const capture = b => { b.order.status = 'COMPLETED'; b.paidAt = new Date().toISOString(); };
const remind = b => ({ by: 'template', text: `Hi ${b.client.split(' ')[0]}, friendly reminder about "${b.service}" on ${b.date} at ${b.start} — $${b.amount}. You can pay securely with PayPal here: ${b.order.approve} Thanks!` });
function book(text) {
  const b = { ...parseRequest(String(text).slice(0, 500), new Date()), parser: 'rules' };
  b.id = db.nextId++; b.text = text; b.createdAt = new Date().toISOString();
  const id = 'MOCK-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  b.order = { id, status: 'CREATED', mock: true, approve: new URL('mock-pay.html?token=' + id, location.href.split('?')[0].replace(/[^/]*$/, '')).href };
  db.bookings.push(b); return view(b);
}
const SAMPLES = ['Lawn mowing for Alice Chen 2h Friday at 10am $80', 'Deep clean for Marco Diaz 3 hours tomorrow at 1pm $120',
  'Math tutoring for Priya 1h Wednesday at 5pm $45', 'Mount TV for Sam Lee 90 min Saturday at 11am $70'];
function route(method, path, body) {
  let m;
  if (path === '/api/config') return { paypal: 'mock', ai: 'rules' };
  if (path === '/api/parse') return parseRequest(String(body.text || ''), new Date());
  if (path === '/api/book' && method === 'POST') { if (!String(body.text || '').trim()) throw Object.assign(new Error('text required'), { status: 400 }); return book(body.text); }
  if (path === '/api/bookings') return db.bookings.map(view);
  if (path === '/api/summary') { const sum = f => db.bookings.filter(f).reduce((a, b) => a + Number(b.amount), 0).toFixed(2);
    return { count: db.bookings.length, paid: sum(isPaid), unpaid: sum(b => !isPaid(b)) }; }
  if (path === '/api/demo/seed') return SAMPLES.filter(s => !db.bookings.some(b => s.includes(b.client))).map(book);
  if (path === '/api/agent/chase') return db.bookings.filter(b => !isPaid(b)).map(b => ({ id: b.id, ...remind(b) }));
  if ((m = path.match(/^\/api\/bookings\/(\d+)(?:\/(capture|remind))?$/))) {
    const b = find(m[1]); if (!b) throw Object.assign(new Error('not found'), { status: 404 });
    if (m[2] === 'capture') { capture(b); return view(b); }
    if (m[2] === 'remind') return isPaid(b) ? { text: null, skipped: 'already paid' } : (b.reminders = (b.reminders || 0) + 1, remind(b));
    if (method === 'PATCH') { const { startDate, endDate } = body;
      if (startDate) { b.date = startDate.slice(0, 10); b.start = startDate.slice(11, 16); }
      if (startDate && endDate) b.hours = Math.max(0.25, (new Date(endDate) - new Date(startDate)) / 36e5);
      return view(b); }
  }
  throw Object.assign(new Error('not found'), { status: 404 });
}
const realFetch = window.fetch.bind(window);
window.fetch = async (url, opts = {}) => {
  const u = new URL(url, location.href), i = u.pathname.indexOf('/api/');
  if (i < 0 || u.origin !== location.origin) return realFetch(url, opts);
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  try { const out = route((opts.method || 'GET').toUpperCase(), u.pathname.slice(i), opts.body ? JSON.parse(opts.body) : {}); save(); return json(out); }
  catch (e) { return json({ error: e.message }, e.status || 500); }
};
// Return from the (mock) PayPal approval page: capture the order, like the server's /paypal/return does.
const q = new URLSearchParams(location.search);
if (q.get('paid')) { const b = db.bookings.find(x => x.order?.id === q.get('paid')); if (b && !isPaid(b)) { capture(b); save(); } }
if (q.has('reset')) { db = { bookings: [], nextId: 1 }; save(); history.replaceState(null, '', location.pathname); }
