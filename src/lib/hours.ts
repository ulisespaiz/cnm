// Formats site.hours for visible text so every page agrees with the JSON-LD.
import { site } from '../config/site';

const DAY_NAMES: Record<string, string> = {
  Mo: 'Monday',
  Tu: 'Tuesday',
  We: 'Wednesday',
  Th: 'Thursday',
  Fr: 'Friday',
  Sa: 'Saturday',
  Su: 'Sunday',
};
const ORDER = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const short = (d: string) => DAY_NAMES[d].slice(0, 3);

// "07:00" -> "7:00am", "14:00" -> "2:00pm"
export function formatTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function dayRange(days: readonly string[]) {
  if (days.length === 1) return DAY_NAMES[days[0]];
  return `${short(days[0])}–${short(days[days.length - 1])}`;
}

export interface HoursRow {
  label: string;
  value: string;
  closed: boolean;
}

// One row per opening block, then one row per closed day.
export function hoursRows(): HoursRow[] {
  const open = new Set(site.hours.flatMap((h) => [...h.days]));
  const rows: HoursRow[] = site.hours.map((h) => ({
    label: dayRange(h.days),
    value: `${formatTime(h.opens)} – ${formatTime(h.closes)}`,
    closed: false,
  }));
  for (const d of ORDER) if (!open.has(d)) rows.push({ label: DAY_NAMES[d], value: 'Closed', closed: true });
  return rows;
}

// "Mon–Fri 7:00am – 4:00pm · Saturday 10:00am – 2:00pm · Sunday closed"
export function hoursSentence() {
  return hoursRows()
    .map((r) => (r.closed ? `${r.label} closed` : `${r.label} ${r.value}`))
    .join(' · ');
}
