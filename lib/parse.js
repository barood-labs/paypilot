// Turns "Lawn mowing for Alice 2h Friday at 3pm $80" into a structured booking.
// LLM first (any OpenAI-compatible endpoint), deterministic rule parser as fallback + validator.
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function resolveDate(text, now = new Date()) {
  const t = text.toLowerCase(), d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m;
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`)))) {
    const c = new Date(d.getFullYear(), MONTHS.indexOf(m[1]), Number(m[2]));
    if (c < d) c.setFullYear(c.getFullYear() + 1);
    return ymd(c);
  }
  if (/\btoday\b|\btonight\b/.test(t)) return ymd(d);
  if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); return ymd(d); }
  if ((m = t.match(/\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/))) {
    const target = DAYS.findIndex(x => x.startsWith(m[2]));
    let diff = (target - d.getDay() + 7) % 7;
    if (diff === 0) diff = 7; // same weekday => next week
    d.setDate(d.getDate() + diff); return ymd(d);
  }
  d.setDate(d.getDate() + 1); return ymd(d); // default: tomorrow
}

export function resolveTime(text) {
  const t = text.toLowerCase();
  let m = t.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (m) { let h = Number(m[1]) % 12; if (m[3] === 'pm') h += 12; return `${pad(h)}:${m[2] || '00'}`; }
  m = t.match(/\bat\s+(\d{1,2}):(\d{2})\b/) || t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${pad(Number(m[1]))}:${m[2]}`;
  if (/\bmorning\b/.test(t)) return '09:00';
  if (/\bafternoon\b/.test(t)) return '14:00';
  if (/\bevening\b|\btonight\b/.test(t)) return '18:00';
  return '09:00';
}

export function categorize(text) {
  const t = text.toLowerCase();
  if (/lawn|mow|garden|yard|hedge|leaf|leaves|snow/.test(t)) return 'Outdoor';
  if (/clean|maid|laundry|dish|tidy/.test(t)) return 'Cleaning';
  if (/tutor|lesson|class|teach|coach|math|piano|guitar/.test(t)) return 'Lessons';
  if (/fix|repair|plumb|paint|install|assembl|handyman|mount/.test(t)) return 'Repairs';
  return 'Other';
}

export function parseRequest(text, now = new Date()) {
  const amt = (text.match(/\$\s?(\d+(?:\.\d{1,2})?)/) || text.match(/(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars|bucks)/i) || [])[1] || '50';
  const hm = text.match(/(\d+(?:\.\d+)?)\s*(?:h\b|hrs?\b|hours?\b)/i);
  const mm = text.match(/(\d+)\s*(?:m\b|mins?\b|minutes?\b)/i);
  const hours = hm ? Number(hm[1]) : mm ? Math.round(Number(mm[1]) / 6) / 10 : 1;
  const client = (text.match(/\b(?:for|with|client)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/) || [])[1] || 'Walk-in client';
  const service = text
    .replace(/\$\s?\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*(?:usd|dollars|bucks)/gi, '')
    .replace(/\b(?:for|with|client)\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?/g, '')
    .replace(/\d+(?:\.\d+)?\s*(?:h|hrs?|hours?|m|mins?|minutes?)\b/gi, '')
    .replace(/\b(?:on|at|next|this)?\s*(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(?:day)?\b|\btoday\b|\btomorrow\b|\btonight\b/gi, '')
    .replace(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
    .replace(/\s+(?:on|at|for)\s*$/i, '').replace(/\s{2,}/g, ' ').replace(/[\s,.-]+$/, '').trim() || 'Service';
  return normalize({ service, client, amount: amt, hours, date: resolveDate(text, now), start: resolveTime(text), category: categorize(text) });
}

export function normalize(b, fallback = {}) {
  const amount = Number(String(b.amount ?? fallback.amount ?? 50).replace(/[^0-9.-]/g, ''));
  const hours = Number(b.hours ?? fallback.hours ?? 1);
  return {
    service: String(b.service || fallback.service || 'Service').slice(0, 80),
    client: String(b.client || fallback.client || 'Walk-in client').slice(0, 60),
    amount: (amount > 0 && amount < 100000 ? amount : 50).toFixed(2),
    hours: hours > 0 && hours <= 24 ? hours : 1,
    date: /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : fallback.date,
    start: /^\d{2}:\d{2}$/.test(b.start) ? b.start : (fallback.start || '09:00'),
    category: ['Outdoor', 'Cleaning', 'Lessons', 'Repairs', 'Other'].includes(b.category) ? b.category : (fallback.category || 'Other'),
  };
}

export async function llmParse(text, now = new Date(), fetchImpl = fetch) {
  const rule = parseRequest(text, now);
  if (!process.env.OPENAI_API_KEY) return { ...rule, parser: 'rules' };
  try {
    const r = await fetchImpl((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' }, temperature: 0,
        messages: [
          { role: 'system', content: `Today is ${ymd(now)} (${DAYS[now.getDay()]}). Extract a service booking as JSON with keys: service (short title), client (name or "Walk-in client"), amount (USD number), hours (number), date (YYYY-MM-DD, next occurrence), start (HH:MM 24h, default 09:00), category (one of Outdoor, Cleaning, Lessons, Repairs, Other). JSON only.` },
          { role: 'user', content: text }] }) });
    const j = await r.json();
    return { ...normalize(JSON.parse(j.choices[0].message.content), rule), parser: 'llm' };
  } catch { return { ...rule, parser: 'rules' }; }
}
