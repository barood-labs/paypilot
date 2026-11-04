import { createCalendar } from '/calendar-adapter.js';
const $ = id => document.getElementById(id);
const api = async (url, opts = {}) => { const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts }); if (!r.ok) throw new Error((await r.json()).error || r.statusText); return r.json(); };
const toast = msg => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3500); };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const grid = agGrid.createGrid($('grid'), {
  rowData: [], getRowId: p => String(p.data.id),
  defaultColDef: { sortable: true, filter: true, resizable: true },
  columnDefs: [
    { field: 'id', width: 70 }, { field: 'client', width: 140 }, { field: 'service', flex: 2 },
    { field: 'date', width: 115 }, { field: 'start', width: 85 }, { field: 'hours', width: 85 },
    { field: 'amount', headerName: 'USD', width: 95, valueFormatter: p => '$' + p.value },
    { field: 'paid', headerName: 'Status', width: 110, filter: true,
      cellRenderer: p => `<span class="pill ${p.value ? 'paid' : 'unpaid'}">${p.value ? 'Paid' : 'Unpaid'}</span>` },
    { field: 'order.id', headerName: 'PayPal order', width: 170 },
    { headerName: 'Actions', width: 260, cellRenderer: p => p.data.paid ? '✔ captured' :
      `<a href="${esc(p.data.order?.approve)}" target="_blank" rel="noopener">Pay link</a> · <a href="#" data-act="capture" data-id="${p.data.id}">Capture</a> · <a href="#" data-act="remind" data-id="${p.data.id}">Remind</a>` },
    { field: 'parser', headerName: 'AI', width: 80 }],
});

const cal = await createCalendar($('cal'), { onMove: async (id, startDate, endDate) => {
  await api('/api/bookings/' + id, { method: 'PATCH', body: JSON.stringify({ startDate, endDate }) });
  toast(`Rescheduled job #${id} to ${startDate.replace('T', ' ').slice(0, 16)}`); refresh(false);
} });
$('calKind').textContent = 'Calendar engine: ' + (cal.kind === 'bryntum' ? 'Bryntum Calendar' : 'FullCalendar (fallback)');
window.paypilot = { cal, grid };

async function refresh(updateCal = true) {
  const [list, s] = await Promise.all([api('/api/bookings'), api('/api/summary')]);
  grid.setGridOption('rowData', list); if (updateCal) cal.setBookings(list);
  $('sCount').textContent = s.count; $('sPaid').textContent = s.paid; $('sUnpaid').textContent = s.unpaid;
  return list;
}
function showReminders(items) {
  $('reminders').hidden = !items.length;
  $('remList').innerHTML = items.map(r => `<li><b>#${r.id}</b> <small>(${esc(r.by)})</small> ${esc(r.text)}</li>`).join('');
}
// Show the agent is working while the (possibly local, slower) LLM thinks.
const busy = (btn, label, fn) => async () => { const old = btn.textContent; btn.disabled = true; btn.textContent = label;
  try { await fn(); } catch (e) { toast('Error: ' + e.message); } finally { btn.disabled = false; btn.textContent = old; } };
$('book').onclick = busy($('book'), '🤖 AI parsing…', async () => { const b = await api('/api/book', { method: 'POST', body: JSON.stringify({ text: $('t').value }) });
  toast(`Booked ${b.service} for ${b.client} on ${b.date} ${b.start} — PayPal order ${b.order.id}`); await refresh(); });
$('seed').onclick = busy($('seed'), '🤖 Booking…', async () => { await api('/api/demo/seed', { method: 'POST' }); await refresh(); });
$('chase').onclick = busy($('chase'), '🤖 Drafting…', async () => { const r = await api('/api/agent/chase', { method: 'POST' }); showReminders(r); toast(r.length ? `Drafted ${r.length} reminder(s)` : 'Everyone has paid 🎉'); });
$('grid').addEventListener('click', async e => {
  const a = e.target.closest('a[data-act]'); if (!a) return; e.preventDefault();
  if (a.dataset.act === 'capture') { await api(`/api/bookings/${a.dataset.id}/capture`, { method: 'POST' }); toast('Payment captured'); refresh(); }
  else { const r = await api(`/api/bookings/${a.dataset.id}/remind`, { method: 'POST' }); showReminders([{ id: a.dataset.id, ...r }]); }
});
const cfg = await api('/api/config');
$('modes').innerHTML = `<span class="badge">PayPal: ${cfg.paypal}</span><span class="badge">AI: ${cfg.ai}</span>`;
const q = new URLSearchParams(location.search); if (q.get('paid')) toast('PayPal payment approved & captured: ' + q.get('paid'));
refresh();
