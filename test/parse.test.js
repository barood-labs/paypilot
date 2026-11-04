import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, resolveDate, resolveTime, normalize, llmParse } from '../lib/parse.js';
const NOW = new Date(2026, 10, 3, 18, 0); // Tue Nov 3 2026

test('rule parser extracts the core fields', () => {
  const p = parseRequest('Lawn mowing for Alice Chen 2h Friday at 10am $80', NOW);
  assert.equal(p.amount, '80.00'); assert.equal(p.hours, 2); assert.equal(p.date, '2026-11-06');
  assert.equal(p.start, '10:00'); assert.equal(p.client, 'Alice Chen'); assert.equal(p.category, 'Outdoor');
  assert.equal(p.service, 'Lawn mowing');
});
test('original MVP sentence still works', () => {
  const p = parseRequest('Lawn mowing 2 hours on Friday for $80', NOW);
  assert.equal(p.amount, '80.00'); assert.equal(p.hours, 2); assert.equal(p.date, '2026-11-06');
});
test('dates: today/tomorrow/same weekday/month name/ISO', () => {
  assert.equal(resolveDate('today', NOW), '2026-11-03');
  assert.equal(resolveDate('tomorrow', NOW), '2026-11-04');
  assert.equal(resolveDate('tuesday', NOW), '2026-11-10');
  assert.equal(resolveDate('Dec 12th', NOW), '2026-12-12');
  assert.equal(resolveDate('Jan 2', NOW), '2027-01-02');
  assert.equal(resolveDate('on 2026-11-20', NOW), '2026-11-20');
});
test('times', () => {
  assert.equal(resolveTime('at 3pm'), '15:00'); assert.equal(resolveTime('12am'), '00:00');
  assert.equal(resolveTime('at 9:30'), '09:30'); assert.equal(resolveTime('in the afternoon'), '14:00');
});
test('minutes and categories', () => {
  const p = parseRequest('Mount TV for Sam Lee 90 min Saturday at 11am $70', NOW);
  assert.equal(p.hours, 1.5); assert.equal(p.category, 'Repairs'); assert.equal(p.date, '2026-11-07');
});
test('normalize rejects junk from the LLM', () => {
  const n = normalize({ amount: '-5', hours: 99, date: 'soon', category: 'Hack' }, { date: '2026-11-04' });
  assert.equal(n.amount, '50.00'); assert.equal(n.hours, 1); assert.equal(n.date, '2026-11-04'); assert.equal(n.category, 'Other');
});
test('llmParse uses LLM output and falls back on errors', async () => {
  process.env.OPENAI_API_KEY = 'test';
  const fake = async () => ({ json: async () => ({ choices: [{ message: { content: JSON.stringify({ service: 'Piano lesson', client: 'Mia', amount: 60, hours: 1, date: '2026-11-09', start: '16:00', category: 'Lessons' }) } }] }) });
  const a = await llmParse('piano for Mia monday 4pm 60 bucks', NOW, fake);
  assert.equal(a.parser, 'llm'); assert.equal(a.amount, '60.00'); assert.equal(a.start, '16:00');
  const b = await llmParse('Deep clean $120 tomorrow', NOW, async () => { throw new Error('down'); });
  assert.equal(b.parser, 'rules'); assert.equal(b.amount, '120.00');
  delete process.env.OPENAI_API_KEY;
});
