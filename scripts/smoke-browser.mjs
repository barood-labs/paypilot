// Headless-Chrome smoke test: boots the app in mock mode, seeds demo jobs, renders the page,
// and checks that the Bryntum Calendar + AG Grid actually painted events/rows. Saves docs/screenshot.png.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createApp } from '../server.js';
const chrome = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
if (!chrome) { console.log('skip: no Chrome found'); process.exit(0); }
const s = createApp().listen(0); await new Promise(r => s.on('listening', r));
const base = `http://127.0.0.1:${s.address().port}`;
await fetch(base + '/api/demo/seed', { method: 'POST' });
const flags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--window-size=1400,1150', '--virtual-time-budget=15000'];
const run = (extra, url) => new Promise((ok, fail) => {
  import('node:child_process').then(({ execFile }) => execFile(chrome, [...flags, ...extra, url], { maxBuffer: 64e6 }, (e, out) => e ? fail(e) : ok(out)));
});
try {
  const results = {};
  for (const [name, q] of [['bryntum', ''], ['fullcalendar', '?calendar=fullcalendar']]) {
    const dom = await run(['--dump-dom'], base + '/' + q);
    results[name] = { engine: (dom.match(/Calendar engine: ([^<]+)/) || [])[1],
      calendarEvents: (dom.match(/b-cal-event-wrap|fc-event-main/g) || []).length,
      gridRows: (dom.match(/class="ag-row /g) || []).length / 2 };
  }
  fs.mkdirSync('docs', { recursive: true });
  await run(['--screenshot=docs/screenshot.png'], base + '/');
  console.log(JSON.stringify(results, null, 2));
  const ok = results.bryntum.engine === 'Bryntum Calendar' && results.bryntum.calendarEvents >= 4 && results.bryntum.gridRows >= 4
    && results.fullcalendar.engine?.startsWith('FullCalendar');
  console.log(ok ? 'SMOKE OK (screenshot: docs/screenshot.png)' : 'SMOKE FAILED'); process.exitCode = ok ? 0 : 1;
} finally { s.close(); }
