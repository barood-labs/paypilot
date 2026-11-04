// PayPilot: an AI booking + payments agent for freelancers.
// Plain-English job -> AI parse -> Bryntum Calendar slot -> PayPal Orders v2 pay link -> AG Grid paid/unpaid board.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from './lib/env.js';
import { llmParse, parseRequest } from './lib/parse.js';
import { createOrder, captureOrder, hasPayPal } from './lib/paypal.js';
import { draftReminder } from './lib/agent.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
loadEnv(process.env.ENV_FILE || path.join(ROOT, '.env'));

const addHours = (date, start, hours) => {
  const d = new Date(`${date}T${start}:00`); d.setMinutes(d.getMinutes() + Math.round(hours * 60));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
};
const isPaid = b => b.order?.status === 'COMPLETED';

export function createApp({ now = () => new Date() } = {}) {
  const app = express();
  app.set('trust proxy', true); // correct https:// pay links behind HF Spaces / Render proxies
  const bookings = [];
  let nextId = 1;
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(path.join(ROOT, 'public')));
  // Bryntum Calendar trial build, served straight from the public npm package (@bryntum/calendar-trial).
  app.use('/vendor/bryntum', express.static(path.join(ROOT, 'node_modules/@bryntum/calendar-trial')));
  const baseUrl = req => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

  const view = b => ({ ...b, paid: isPaid(b), startDate: `${b.date}T${b.start}:00`, endDate: addHours(b.date, b.start, b.hours) });
  const find = id => bookings.find(b => b.id === Number(id));

  async function book(text, req) {
    const b = await llmParse(String(text || '').slice(0, 500), now());
    b.id = nextId++; b.text = text; b.createdAt = now().toISOString();
    b.order = await createOrder(b, { baseUrl: baseUrl(req) });
    bookings.push(b); return view(b);
  }

  app.get('/api/config', (_q, res) => res.json({ paypal: hasPayPal() ? 'sandbox' : 'mock', ai: process.env.OPENAI_API_KEY ? 'llm' : 'rules' }));
  app.post('/api/parse', (req, res) => res.json(parseRequest(String(req.body.text || ''), now())));
  app.post('/api/book', async (req, res, next) => {
    try { if (!String(req.body.text || '').trim()) return res.status(400).json({ error: 'text required' }); res.json(await book(req.body.text, req)); }
    catch (e) { next(e); }
  });
  app.get('/api/bookings', (_q, res) => res.json(bookings.map(view)));
  app.get('/api/summary', (_q, res) => {
    const sum = f => bookings.filter(f).reduce((a, b) => a + Number(b.amount), 0).toFixed(2);
    res.json({ count: bookings.length, paid: sum(isPaid), unpaid: sum(b => !isPaid(b)) });
  });
  // Drag/resize in the Bryntum Calendar lands here.
  app.patch('/api/bookings/:id', (req, res) => {
    const b = find(req.params.id); if (!b) return res.status(404).json({ error: 'not found' });
    const { startDate, endDate } = req.body;
    if (startDate) { b.date = startDate.slice(0, 10); b.start = startDate.slice(11, 16); }
    if (startDate && endDate) b.hours = Math.max(0.25, (new Date(endDate) - new Date(startDate)) / 36e5);
    res.json(view(b));
  });
  app.post('/api/bookings/:id/capture', async (req, res, next) => {
    try { const b = find(req.params.id); if (!b) return res.status(404).json({ error: 'not found' });
      const c = await captureOrder(b.order.id); b.order.status = c.status; b.paidAt = isPaid(b) ? now().toISOString() : undefined; res.json(view(b)); }
    catch (e) { next(e); }
  });
  app.post('/api/bookings/:id/remind', async (req, res, next) => {
    try { const b = find(req.params.id); if (!b) return res.status(404).json({ error: 'not found' });
      if (isPaid(b)) return res.json({ text: null, skipped: 'already paid' });
      const r = await draftReminder(b); b.reminders = (b.reminders || 0) + 1; res.json(r); }
    catch (e) { next(e); }
  });
  app.post('/api/agent/chase', async (_q, res, next) => { // agent sweep: draft reminders for every unpaid booking
    try { const out = []; for (const b of bookings.filter(x => !isPaid(x))) out.push({ id: b.id, ...(await draftReminder(b)) }); res.json(out); }
    catch (e) { next(e); }
  });
  // PayPal redirects the buyer back here after approval (sandbox or mock page); we capture server-side.
  app.get('/paypal/return', async (req, res, next) => {
    try { const b = bookings.find(x => x.order?.id === req.query.token);
      if (b) { const c = await captureOrder(b.order.id); b.order.status = c.status; b.paidAt = now().toISOString(); }
      res.redirect('/?paid=' + encodeURIComponent(req.query.token || '')); }
    catch (e) { next(e); }
  });
  app.post('/api/demo/seed', async (req, res) => {
    const samples = ['Lawn mowing for Alice Chen 2h Friday at 10am $80', 'Deep clean for Marco Diaz 3 hours tomorrow at 1pm $120',
      'Math tutoring for Priya 1h Wednesday at 5pm $45', 'Mount TV for Sam Lee 90 min Saturday at 11am $70'];
    const out = []; for (const s of samples) if (!bookings.some(b => s.includes(b.client))) out.push(await book(s, req)); // skip clients already booked
    res.json(out);
  });
  app.use((err, _q, res, _n) => { console.error(err); res.status(500).json({ error: err.message }); });
  return app;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = process.env.PORT || 3000;
  createApp().listen(port, () => console.log(`PayPilot on http://localhost:${port}  (PayPal: ${hasPayPal() ? 'sandbox' : 'mock'}, AI: ${process.env.OPENAI_API_KEY ? 'llm' : 'rules'})`));
}
export { parseRequest };
