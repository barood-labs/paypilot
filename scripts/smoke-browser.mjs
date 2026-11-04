// Headless-Chrome smoke test (no extra deps: raw DevTools protocol over Node's built-in WebSocket).
// Boots the app in mock mode, seeds demo jobs, loads the page with both calendar engines and checks that
// Bryntum Calendar / FullCalendar + AG Grid actually painted events and rows. Saves docs/screenshot.png.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createApp } from '../server.js';
const chrome = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
if (!chrome) { console.log('skip: no Chrome found'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const s = createApp().listen(0); await new Promise(r => s.on('listening', r));
const base = `http://127.0.0.1:${s.address().port}`;
await fetch(base + '/api/demo/seed', { method: 'POST' });
const profile = fs.mkdtempSync('/tmp/paypilot-chrome-'), port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--disable-extensions',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1400,1150', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const pending = new Map(), logs = [];
const send = (method, params = {}) => new Promise(ok => { const id = ++seq; pending.set(id, ok); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
try {
  let target; for (let i = 0; i < 50 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch { await sleep(200); } }
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + m.params.exceptionDetails.exception?.description);
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' ')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1150, deviceScaleFactor: 1, mobile: false });
  const results = {};
  for (const [name, q] of [['fullcalendar', '?calendar=fullcalendar'], ['bryntum', '']]) {
    await send('Page.navigate', { url: base + '/' + q }); await sleep(6000);
    results[name] = await evaluate(`({ engine: document.getElementById('calKind').textContent,
      calendarEvents: document.querySelectorAll('.b-cal-event-wrap, .fc-event').length,
      gridRows: new Set([...document.querySelectorAll('#grid .ag-row[row-index]')].map(r => r.getAttribute('row-index'))).size,
      jobs: document.getElementById('sCount').textContent })`);
  }
  // Simulate a drag in Bryntum: move job #1 one day later, then confirm the server got the reschedule.
  results.reschedule = await evaluate(`(async () => { const r = paypilot.cal.widget.eventStore.getById(1);
    const before = (await (await fetch('/api/bookings')).json())[0].date;
    const s = new Date(r.startDate), e = new Date(r.endDate); s.setDate(s.getDate() + 1); e.setDate(e.getDate() + 1);
    r.setStartEndDate(s, e); await new Promise(ok => setTimeout(ok, 800));
    const after = (await (await fetch('/api/bookings')).json())[0].date; return { before, after }; })()`);
  // Capture job #2 through the UI link and check the paid total updates.
  results.capture = await evaluate(`(async () => { document.querySelector('#grid a[data-act="capture"][data-id="2"]').click();
    await new Promise(ok => setTimeout(ok, 1200)); return document.getElementById('sPaid').textContent; })()`);
  await sleep(500);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/screenshot.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  console.log(JSON.stringify(results, null, 2)); if (logs.length) console.log('browser log:\n' + logs.join('\n'));
  const ok = results.bryntum.engine.includes('Bryntum') && results.bryntum.calendarEvents >= 4 && results.bryntum.gridRows >= 4
    && results.fullcalendar.engine.includes('FullCalendar') && results.fullcalendar.calendarEvents >= 4
    && results.reschedule.before !== results.reschedule.after && results.capture === '120.00';
  console.log(ok ? 'SMOKE OK (screenshot: docs/screenshot.png)' : 'SMOKE FAILED'); process.exitCode = ok ? 0 : 1;
} finally { ws?.close(); proc.kill(); s.close(); await sleep(300); fs.rmSync(profile, { recursive: true, force: true }); }
