// Everything in this app decides "what day is it" using one fixed timezone,
// not the browser's clock or the server's clock. Vercel runs in UTC, so
// without this an evening gig can end up blocking the wrong calendar day.
//
// Set NEXT_PUBLIC_SITE_TIMEZONE in your environment to change it.
export const SITE_TIMEZONE = process.env.NEXT_PUBLIC_SITE_TIMEZONE || 'Asia/Manila';

// Turns a Date into a "YYYY-MM-DD" string as seen in the given timezone.
// en-CA formatting happens to produce exactly that layout.
export function dateKey(date, timeZone = SITE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

// The clock time (HH:MM) of a Date in the given timezone.
export function timeInZone(date, timeZone = SITE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

// Adds (or subtracts) whole days to a "YYYY-MM-DD" key.
export function addDays(key, days) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayKey(timeZone = SITE_TIMEZONE) {
  return dateKey(new Date(), timeZone);
}