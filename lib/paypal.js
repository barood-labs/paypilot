// PayPal Orders v2 (sandbox by default). Without credentials everything runs in a clearly-labelled mock mode.
const BASE = () => process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
export const hasPayPal = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
let cached = null;
async function token(fetchImpl) {
  if (cached && cached.exp > Date.now()) return cached.t;
  const r = await fetchImpl(BASE() + '/v1/oauth2/token', { method: 'POST', body: 'grant_type=client_credentials',
    headers: { Authorization: 'Basic ' + Buffer.from(process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await r.json(); if (!j.access_token) throw new Error('PayPal auth failed');
  cached = { t: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 }; return cached.t;
}
export async function createOrder(b, { baseUrl = 'http://localhost:3000', fetchImpl = fetch } = {}) {
  if (!hasPayPal()) {
    const id = 'MOCK-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
    return { id, status: 'CREATED', mock: true, approve: `${baseUrl}/mock-pay.html?token=${id}` };
  }
  const t = await token(fetchImpl);
  const r = await fetchImpl(BASE() + '/v2/checkout/orders', { method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', 'PayPal-Request-Id': 'paypilot-' + b.id + '-' + Date.now() },
    body: JSON.stringify({ intent: 'CAPTURE',
      purchase_units: [{ reference_id: 'booking-' + b.id, description: `${b.service} (${b.date} ${b.start})`.slice(0, 127),
        amount: { currency_code: 'USD', value: b.amount } }],
      payment_source: { paypal: { experience_context: { brand_name: 'PayPilot', user_action: 'PAY_NOW',
        return_url: `${baseUrl}/paypal/return`, cancel_url: `${baseUrl}/?cancelled=1` } } } }) });
  const j = await r.json();
  const approve = (j.links || []).find(l => l.rel === 'approve' || l.rel === 'payer-action')?.href;
  return { id: j.id, status: j.status, mock: false, approve };
}
export async function captureOrder(orderId, { fetchImpl = fetch } = {}) {
  if (!hasPayPal() || String(orderId).startsWith('MOCK-')) return { id: orderId, status: 'COMPLETED', mock: true };
  const t = await token(fetchImpl);
  const r = await fetchImpl(`${BASE()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
  const j = await r.json(); return { id: j.id || orderId, status: j.status || 'FAILED', mock: false };
}
