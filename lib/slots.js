import { addDays } from './timezone';

// Minutes he needs between the end of one gig and the start of the next —
// packing up, travel, setup. Overridable per-site in the profile table.
export const DEFAULT_BUFFER_MINUTES = 60;

export const MIN_GIG_MINUTES = 15;
export const MAX_GIG_MINUTES = 12 * 60;

export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// "14:30" -> "2:30 PM"
export function formatTime(hhmm) {
  if (!isValidTime(hhmm)) return hhmm || '';
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatRange(range) {
  return `${formatTime(range.start)} – ${formatTime(range.end)}`;
}

// A range is { start: "HH:MM", end: "HH:MM" }. If the end is at or before the
// start, the gig runs past midnight — an 11pm to 1am club set — so its end
// belongs to the following day. Converting to absolute minutes keeps the
// comparison maths honest.
export function toSpan(range, offsetMinutes = 0) {
  const start = toMinutes(range.start);
  let end = toMinutes(range.end);
  if (end <= start) end += 1440;
  return { start: start + offsetMinutes, end: end + offsetMinutes };
}

export function durationMinutes(range) {
  const span = toSpan(range);
  return span.end - span.start;
}

export function spansClash(a, b, buffer) {
  return a.start < b.end + buffer && b.start < a.end + buffer;
}

// Compares a proposed range against everything already on that day, plus the
// day either side — otherwise a set finishing at 1am wouldn't notice the gig
// that starts at 2am, and a midnight finish wouldn't notice the next morning.
// Returns the clashing range, or null if the slot is free.
export function findClash(range, date, rangesByDate, buffer = DEFAULT_BUFFER_MINUTES) {
  const candidate = toSpan(range);
  const neighbours = [[-1, -1440], [0, 0], [1, 1440]];

  for (const [dayShift, minuteShift] of neighbours) {
    const key = dayShift === 0 ? date : addDays(date, dayShift);
    for (const existing of (rangesByDate && rangesByDate[key]) || []) {
      if (spansClash(candidate, toSpan(existing, minuteShift), buffer)) {
        return { date: key, ...existing };
      }
    }
  }
  return null;
}

// Why a proposed range is unusable, or null if it's fine.
export function rangeProblem(range) {
  if (!isValidTime(range.start) || !isValidTime(range.end)) return 'Please give a start and end time.';
  const mins = durationMinutes(range);
  if (mins < MIN_GIG_MINUTES) return 'That slot is too short.';
  if (mins > MAX_GIG_MINUTES) return 'That slot is longer than 12 hours.';
  return null;
}

export async function getBufferMinutes(supabase) {
  try {
    const { data } = await supabase.from('profile').select('buffer_minutes').eq('id', 1).maybeSingle();
    const n = data && Number(data.buffer_minutes);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BUFFER_MINUTES;
  } catch {
    return DEFAULT_BUFFER_MINUTES;
  }
}