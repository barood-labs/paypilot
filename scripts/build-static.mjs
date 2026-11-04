// Builds the static GitHub Pages demo into dist/ (mock PayPal + rule parser running in the browser).
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), OUT = path.join(ROOT, 'dist');
const BRYNTUM = 'https://cdn.jsdelivr.net/npm/@bryntum/calendar-trial@' + JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@bryntum/calendar-trial/package.json'))).version + '/';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
const rel = s => s.replaceAll('/vendor/bryntum/', BRYNTUM).replace(/(["'(])\/(app|calendar-adapter|style|mock-pay)\.(js|css|html)/g, '$1./$2.$3');
for (const f of ['app.js', 'calendar-adapter.js', 'style.css']) fs.writeFileSync(path.join(OUT, f), rel(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')));
fs.writeFileSync(path.join(OUT, 'index.html'), rel(fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'))
  .replace('<script type="module" src="./app.js">', '<script type="module" src="./static-backend.js"></script>\n<script type="module" src="./app.js">')
  .replace('Sandbox / mock only', 'Hosted static demo: mock PayPal, rule-based parser, data stays in your browser (<a href="?reset">reset</a>). Sandbox / mock only'));
fs.writeFileSync(path.join(OUT, 'mock-pay.html'), rel(fs.readFileSync(path.join(ROOT, 'public/mock-pay.html'), 'utf8'))
  .replace("location.href='/paypal/return?token='", "location.href='./?paid='").replace('href="/"', 'href="./"'));
fs.copyFileSync(path.join(ROOT, 'static/static-backend.js'), path.join(OUT, 'static-backend.js'));
fs.copyFileSync(path.join(ROOT, 'lib/parse.js'), path.join(OUT, 'lib/parse.js'));
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('built', OUT);
