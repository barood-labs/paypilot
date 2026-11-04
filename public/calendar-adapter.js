// Calendar adapter: Bryntum Calendar (primary, trial build from npm @bryntum/calendar-trial)
// with a FullCalendar fallback so the app never breaks if Bryntum assets are missing.
// Both expose the same tiny interface: { kind, setBookings(bookings) } and call onMove(id, startISO, endISO).
const COLORS = { paid: 'green', unpaid: 'orange' };
const RESOURCES = [
  { id: 'Outdoor', name: 'Outdoor', eventColor: 'green' }, { id: 'Cleaning', name: 'Cleaning', eventColor: 'cyan' },
  { id: 'Lessons', name: 'Lessons', eventColor: 'violet' }, { id: 'Repairs', name: 'Repairs', eventColor: 'blue' },
  { id: 'Other', name: 'Other', eventColor: 'gray' }];
const title = b => `${b.paid ? '✔ PAID' : '⏳ $' + b.amount} · ${b.service} — ${b.client}`;
const toLocalISO = d => { const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`; };

async function bryntum(el, { onMove }) {
  const { Calendar } = await import('/vendor/bryntum/calendar.module.js');
  let syncing = false;
  const cal = new Calendar({
    appendTo: el, date: new Date(), mode: 'week', resources: RESOURCES, events: [],
    sidebar: { items: { resourceFilter: { title: 'Service lines' } } },
    modes: { day: true, week: true, month: true, agenda: true, year: false },
  });
  cal.eventStore.on('update', ({ record, changes }) => {
    if (syncing || !(changes.startDate || changes.endDate)) return;
    onMove(record.id, toLocalISO(record.startDate), toLocalISO(record.endDate));
  });
  return {
    kind: 'bryntum',
    widget: cal,
    setBookings(list) {
      syncing = true;
      cal.eventStore.data = list.map(b => ({ id: b.id, name: title(b), startDate: b.startDate, endDate: b.endDate,
        resourceId: b.category || 'Other', eventColor: b.paid ? COLORS.paid : COLORS.unpaid }));
      syncing = false;
      if (list.length) cal.date = new Date(list[list.length - 1].startDate);
    },
  };
}

async function fullcalendar(el, { onMove }) {
  await new Promise((ok, fail) => { const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/fullcalendar@6.1.15/index.global.min.js'; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  const cal = new window.FullCalendar.Calendar(el, { initialView: 'timeGridWeek', editable: true, height: '100%',
    eventDrop: i => onMove(Number(i.event.id), toLocalISO(i.event.start), toLocalISO(i.event.end)),
    eventResize: i => onMove(Number(i.event.id), toLocalISO(i.event.start), toLocalISO(i.event.end)) });
  cal.render();
  return { kind: 'fullcalendar', widget: cal, setBookings(list) {
    cal.removeAllEvents();
    list.forEach(b => cal.addEvent({ id: String(b.id), title: title(b), start: b.startDate, end: b.endDate, color: b.paid ? '#2e7d32' : '#ef6c00' }));
    if (list.length) cal.gotoDate(list[list.length - 1].startDate);
  } };
}

export async function createCalendar(el, opts) {
  const force = new URLSearchParams(location.search).get('calendar');
  if (force !== 'fullcalendar') {
    try { return await bryntum(el, opts); } catch (e) { console.warn('Bryntum unavailable, falling back to FullCalendar:', e); el.innerHTML = ''; }
  }
  return fullcalendar(el, opts);
}
