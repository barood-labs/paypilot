// Tiny .env loader (no dependency). Never commit real keys: point ENV_FILE at a file outside the repo.
import fs from 'fs';
export function loadEnv(file) {
  if (!file || !fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return true;
}
