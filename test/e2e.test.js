// End-to-end: real HTTP server, mock PayPal mode, then sandbox mode against a local fake PayPal API.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createApp } from '../server.js';

const listen = app => new Promise(ok => { const s = app.listen(0, () => ok(s)); });
const j = (base, p, opts = {}) => fetch(base + p, { headers: { 'Content-Type': 'application/json' }, ...opts })
  .then(async r => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text(), url: r.url }));

test('mock mode: book -> calendar data -> reschedule -> remind -> pay -> summary', async () => {
  delete process.env.PAYPAL_CLIENT_ID; delete process.env.PAYPAL_CLIENT_SECRET; delete process.env.OPENAI_API_KEY;
  const s = await listen(createApp({ now: () => new Date(2026, 10, 3, 18) })); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.deepEqual((await j(base, '/api/config')).body, { paypal: 'mock', ai: 'rules' });
    assert.equal((await j(base, '/api/book', { method: 'POST', body: '{"text":""}' })).status, 400);
    const b = (await j(base, '/api/book', { method: 'POST', body: JSON.stringify({ text: 'Lawn mowing for Alice Chen 2h Friday at 10am $80' }) })).body;
    assert.equal(b.startDate, '2026-11-06T10:00:00'); assert.equal(b.endDate, '2026-11-06T12:00:00');
    assert.match(b.order.id, /^MOCK-/); assert.equal(b.paid, false); assert.match(b.order.approve, /mock-pay\.html\?token=MOCK-/);
    const moved = (await j(base, `/api/bookings/${b.id}`, { method: 'PATCH', body: JSON.stringify({ startDate: '2026-11-07T09:00:00', endDate: '2026-11-07T12:00:00' }) })).body;
    assert.equal(moved.date, '2026-11-07'); assert.equal(moved.hours, 3);
    const rem = (await j(base, `/api/bookings/${b.id}/remind`, { method: 'POST' })).body;
    assert.match(rem.text, /Alice/); assert.ok(rem.text.includes(b.order.approve));
    const ret = await j(base, `/paypal/return?token=${b.order.id}`); // buyer approves on the (mock) PayPal page
    assert.match(ret.url, /\?paid=MOCK-/);
    const list = (await j(base, '/api/bookings')).body; assert.equal(list[0].paid, true);
    await j(base, '/api/demo/seed', { method: 'POST' });
    const chase = (await j(base, '/api/agent/chase', { method: 'POST' })).body; assert.equal(chase.length, 4);
    const cap = (await j(base, '/api/bookings/2/capture', { method: 'POST' })).body; assert.equal(cap.paid, true);
    const sum = (await j(base, '/api/summary')).body; assert.equal(sum.count, 5); assert.equal(sum.paid, '160.00'); assert.equal(sum.unpaid, '235.00');
    const page = await j(base, '/'); assert.match(page.body, /PayPilot/);
    const bry = await fetch(base + '/vendor/bryntum/calendar.module.js', { method: 'HEAD' }); assert.equal(bry.status, 200);
  } finally { s.close(); }
});

test('sandbox mode: talks Orders v2 (token, create, capture) to PayPal API', async () => {
  const calls = []; const fake = express(); fake.use(express.json()); fake.use(express.urlencoded({ extended: false }));
  fake.post('/v1/oauth2/token', (req, res) => { calls.push('token:' + req.headers.authorization.slice(0, 6)); res.json({ access_token: 'A21', expires_in: 3600 }); });
  fake.post('/v2/checkout/orders', (req, res) => { calls.push('create:' + req.body.purchase_units[0].amount.value);
    res.json({ id: '5O190127TN364715T', status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T' }] }); });
  fake.post('/v2/checkout/orders/:id/capture', (req, res) => { calls.push('capture:' + req.params.id); res.json({ id: req.params.id, status: 'COMPLETED' }); });
  const fs = await listen(fake);
  Object.assign(process.env, { PAYPAL_CLIENT_ID: 'sb-id', PAYPAL_CLIENT_SECRET: 'sb-secret', PAYPAL_API_BASE: `http://127.0.0.1:${fs.address().port}` });
  const s = await listen(createApp()); const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const b = (await j(base, '/api/book', { method: 'POST', body: JSON.stringify({ text: 'Deep clean for Marco Diaz 3 hours tomorrow at 1pm $120' }) })).body;
    assert.equal(b.order.id, '5O190127TN364715T'); assert.match(b.order.approve, /sandbox\.paypal\.com/); assert.equal(b.order.mock, false);
    const cap = (await j(base, `/api/bookings/${b.id}/capture`, { method: 'POST' })).body; assert.equal(cap.paid, true);
    assert.deepEqual(calls, ['token:Basic ', 'create:120.00', 'capture:5O190127TN364715T']);
  } finally { s.close(); fs.close(); for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_API_BASE']) delete process.env[k]; }
});
