// Headless-Chrome smoke test against a running/hosted PayPilot URL (raw DevTools protocol, no deps).
// Usage: node scripts/smoke-hosted.mjs https://barood-labs.github.io/paypilot/
// Checks: Bryntum Calendar renders, "Load demo jobs" books 4 jobs, mock PayPal checkout loop captures, agent chase drafts reminders.
import { spawn } from 'node:child_process'; import fs from 'node:fs';
const BASE = (process.argv[2] || 'http://localhost:3000/').replace(/\/?$/, '/');
const chrome = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(fs.existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = fs.mkdtempSync('/tmp/pp-hosted-'), port = 9800 + Math.floor(Math.random() * 100);
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-extensions', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, '--window-size=1400,1100', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(), errs = [];
const send = (method, params = {}) => new Promise(ok => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
const waitFor = async (e, ms = 20000) => { for (let t = 0; t < ms; t += 250) { if (await ev(e).catch(() => 0)) return true; await sleep(250); } return false; };
const results = {}; let ok = true; const check = (k, v) => { results[k] = v; if (!v) ok = false; };
try {
  let target; for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(200); } }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE + '?reset' });
  check('bryntum calendar rendered', await waitFor(`document.getElementById('calKind')?.textContent.includes('Bryntum') && !!document.querySelector('.b-calendar')`));
  await ev(`document.getElementById('seed').click()`);
  check('demo jobs: 4 grid rows', await waitFor(`document.querySelectorAll('#grid .ag-row').length === 4`));
  check('demo jobs: calendar events', await waitFor(`document.querySelectorAll('.b-cal-event-wrap').length >= 1`));
  const pay = await ev(`document.querySelector('#grid a[target=_blank]')?.href`); results.payLink = pay;
  check('pay link is https (or local)', /^https:|^http:\/\/(localhost|127)/.test(pay || ''));
  await send('Page.navigate', { url: pay }); await waitFor(`!!document.getElementById('ok')`);
  await ev(`document.getElementById('ok').click()`);
  check('mock checkout returned + captured', await waitFor(`location.search.includes('paid=') && parseFloat(document.getElementById('sPaid')?.textContent) > 0`));
  results.paidUnpaid = await ev(`document.getElementById('sPaid').textContent + ' / ' + document.getElementById('sUnpaid').textContent`);
  check('grid shows Paid pill', await waitFor(`!!document.querySelector('#grid .pill.paid')`));
  await ev(`document.getElementById('chase').click()`);
  check('agent drafted 3 reminders', await waitFor(`document.querySelectorAll('#remList li').length === 3`));
  check('no page exceptions', errs.length === 0);
  const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/pp-hosted.png', Buffer.from(shot.data, 'base64'));
} catch (e) { ok = false; results.error = String(e); }
finally { proc.kill(); }
console.log(JSON.stringify({ base: BASE, ok, results, errs }, null, 1)); process.exit(ok ? 0 : 1);
