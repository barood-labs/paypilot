// The "chase unpaid" agent step: writes a short, polite reminder with the PayPal link.
export async function draftReminder(b, fetchImpl = fetch) {
  const fallback = `Hi ${b.client.split(' ')[0]}, friendly reminder about "${b.service}" on ${b.date} at ${b.start} — $${b.amount}. ` +
    `You can pay securely with PayPal here: ${b.order?.approve || '(link pending)'} Thanks!`;
  if (!process.env.OPENAI_API_KEY) return { text: fallback, by: 'template' };
  try {
    const r = await fetchImpl((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.4, messages: [
        { role: 'system', content: 'Write a friendly 2-sentence SMS payment reminder from a small service business. Must include the exact pay link given. No emojis.' },
        { role: 'user', content: JSON.stringify({ client: b.client, service: b.service, date: b.date, start: b.start, amount: b.amount, link: b.order?.approve }) }] }) });
    const text = (await r.json()).choices[0].message.content.trim();
    return text.includes(b.order?.approve || '') ? { text, by: 'llm' } : { text: fallback, by: 'template' };
  } catch { return { text: fallback, by: 'template' }; }
}
