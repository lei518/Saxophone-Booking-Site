import ical from 'node-ical';
import { SITE_TIMEZONE, dateKey, timeInZone, addDays, todayKey } from './timezone';

const LOOKAHEAD_DAYS = 365;
const CACHE_MS = 5 * 60 * 1000; // don't refetch the feed on every page load

let cache = { at: 0, result: { days: [], ranges: {} } };

// Google marks an event "Free" rather than "Busy" with TRANSP:TRANSPARENT.
// Those shouldn't block anything.
function blocksTime(ev) {
  if (!ev || ev.type !== 'VEVENT' || !ev.start) return false;
  if (ev.status === 'CANCELLED') return false;
  if (ev.transparency === 'TRANSPARENT') return false;
  return true;
}

function isAllDay(ev) {
  return ev.datetype === 'date' || (ev.start && ev.start.dateOnly === true);
}

export async function getBusyCalendar() {
  const url = process.env.GOOGLE_ICS_URL;
  if (!url) return { days: [], ranges: {} };

  if (Date.now() - cache.at < CACHE_MS) return cache.result;

  try {
    const data = await ical.async.fromURL(url);

    const from = todayKey();
    const to = addDays(from, LOOKAHEAD_DAYS);
    const rangeStart = new Date(from + 'T00:00:00Z');
    const rangeEnd = new Date(to + 'T23:59:59Z');

    const days = new Set();   // whole days he is unavailable
    const ranges = {};        // date -> [{ start, end }] of busy times

    const inWindow = (key) => key >= from && key <= to;

    const markWholeDays = (firstKey, lastKey) => {
      let day = firstKey;
      for (let i = 0; day <= lastKey && i <= LOOKAHEAD_DAYS + 1; i++) {
        if (inWindow(day)) days.add(day);
        day = addDays(day, 1);
      }
    };

    const mark = (start, end, allDay) => {
      if (allDay) {
        // All-day events sit on UTC midnight markers, and DTEND is the day
        // *after* the event ends, so a single day runs 15th to 16th.
        const first = dateKey(start, 'UTC');
        let last = end ? dateKey(end, 'UTC') : first;
        if (last > first) last = addDays(last, -1);
        markWholeDays(first, last);
        return;
      }

      const first = dateKey(start, SITE_TIMEZONE);
      const startTime = timeInZone(start, SITE_TIMEZONE);
      const endTime = end ? timeInZone(end, SITE_TIMEZONE) : startTime;
      let last = end ? dateKey(end, SITE_TIMEZONE) : first;

      // Ends exactly at midnight - that belongs to the day it started on.
      if (last > first && endTime === '00:00') last = addDays(last, -1);

      if (last > first) {
        // Genuinely spans multiple days, so block them outright rather than
        // pretending it is a slot someone could book around.
        markWholeDays(first, last);
        return;
      }

      if (inWindow(first)) {
        if (!ranges[first]) ranges[first] = [];
        ranges[first].push({ start: startTime, end: endTime });
      }
    };

    for (const key in data) {
      const ev = data[key];
      if (!blocksTime(ev)) continue;

      const allDay = isAllDay(ev);
      const start = new Date(ev.start);
      const end = ev.end ? new Date(ev.end) : new Date(ev.start);
      const durationMs = Math.max(0, end.getTime() - start.getTime());

      // Repeating events - a weekly residency - need every occurrence.
      if (ev.rrule) {
        const skip = new Set(
          Object.values(ev.exdate || {}).map((d) => new Date(d).getTime())
        );
        for (const occ of ev.rrule.between(rangeStart, rangeEnd, true)) {
          if (skip.has(occ.getTime())) continue;
          mark(occ, new Date(occ.getTime() + durationMs), allDay);
        }
        // Occurrences he edited individually.
        for (const changed of Object.values(ev.recurrences || {})) {
          if (!blocksTime(changed)) continue;
          mark(
            new Date(changed.start),
            changed.end ? new Date(changed.end) : new Date(changed.start),
            isAllDay(changed)
          );
        }
        continue;
      }

      mark(start, end, allDay);
    }

    cache = { at: Date.now(), result: { days: Array.from(days), ranges } };
    return cache.result;
  } catch (e) {
    console.error('Could not read Google Calendar feed:', e.message);
    // Serve the last good result so a blip does not show booked days as open.
    return cache.result;
  }
}