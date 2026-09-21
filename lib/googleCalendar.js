import crypto from 'crypto';
import { SITE_TIMEZONE, addDays } from './timezone';
import { toMinutes } from './slots';

// Adds approved gigs to his Google Calendar using a service account: a
// robot Google account that belongs to this site. He shares his calendar
// with it once ("Make changes to events") and it can add events from then on.
//
// No extra npm packages: Google's sign-in for service accounts is a signed
// token, which Node's built-in crypto can produce.
//
// Without the three GOOGLE_* variables set - which is how you'll run it
// locally at first - it prints the event it would have created instead.

let cachedToken = { value: null, expiresAt: 0 };

// Private keys get mangled easily on the way into .env: real line breaks
// instead of "\n", missing quotes, or a stray quote or comma copied from the
// JSON file. This pulls the key's contents out and rebuilds it cleanly, so
// all of those still work. It returns an error only if the key is genuinely
// incomplete.
function normalizePrivateKey(raw) {
  let text = String(raw).trim()
    .replace(/,\s*$/, '')          // trailing comma from the JSON line
    .replace(/^["']+|["']+$/g, '') // stray wrapping quotes
    .replace(/\\n/g, '\n')         // literal \n -> real line breaks
    .replace(/\r/g, '');

  const match = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (!match) {
    if (text.includes('BEGIN PRIVATE KEY')) {
      return { error: 'GOOGLE_PRIVATE_KEY is cut off: the "-----END PRIVATE KEY-----" part is missing. Paste the whole value on one line, inside double quotes.' };
    }
    // Name what was pasted instead, without echoing any of it back.
    const found =
      /^[0-9a-f]{40}$/i.test(text) ? 'the "private_key_id" (a short ID), not the "private_key"'
      : text.includes('@') ? 'an email address'
      : /^\d+$/.test(text) ? 'a number, probably the "client_id"'
      : text.startsWith('http') ? 'a web address'
      : `${text.length} characters that don’t start with "-----BEGIN PRIVATE KEY-----"`;
    return {
      error: `GOOGLE_PRIVATE_KEY contains ${found}. Use the "private_key" value from the JSON file. It starts with -----BEGIN PRIVATE KEY----- and is about 1,700 characters long.`,
    };
  }

  const body = match[1].replace(/[^A-Za-z0-9+/=]/g, '');
  if (body.length < 1000) {
    return { error: `GOOGLE_PRIVATE_KEY looks incomplete (${body.length} characters; a full key is about 1,600). Copy it again from the JSON file.` };
  }

  const pem = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  try {
    crypto.createPrivateKey(pem);
  } catch {
    return { error: 'GOOGLE_PRIVATE_KEY couldn’t be read. Some characters may have been changed while copying. Copy it again from the JSON file.' };
  }
  return { key: pem };
}

function config() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!email || !rawKey || !calendarId) return null;

  const { key, error } = normalizePrivateKey(rawKey);
  if (error) return { error };
  return { email: email.trim(), key, calendarId: calendarId.trim() };
}

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken(cfg) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.expiresAt - 60 > now) return cachedToken.value;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: cfg.email,
    scope: 'https://www.googleapis.com/auth/calendar.events',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = base64url(signer.sign(cfg.key));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Google sign-in failed (${res.status})`);
  }
  cachedToken = { value: data.access_token, expiresAt: now + (data.expires_in || 3600) };
  return cachedToken.value;
}

// Builds the calendar event from a booking request.
export function eventFor(request) {
  // A set that ends at or before it starts runs past midnight, so it ends
  // on the following calendar day.
  const endsNextDay = toMinutes(request.end_time) <= toMinutes(request.start_time);
  const endDate = endsNextDay ? addDays(request.date, 1) : request.date;

  const description = [
    `Client: ${request.name}`,
    `Email: ${request.email}`,
    request.phone && `Phone: ${request.phone}`,
    `Event: ${request.type}`,
    request.message && `\nNotes from the client:\n${request.message}`,
    '\nBooked through the website.',
  ].filter(Boolean).join('\n');

  return {
    summary: `${request.type}: ${request.name}`,
    description,
    start: { dateTime: `${request.date}T${request.start_time}:00`, timeZone: SITE_TIMEZONE },
    end: { dateTime: `${endDate}T${request.end_time}:00`, timeZone: SITE_TIMEZONE },
    reminders: { useDefault: true },
  };
}

// Returns { ok, eventId?, previewed?, error? }. Never throws: a calendar
// problem must not undo an approval.
export async function addGigToCalendar(request) {
  const event = eventFor(request);
  const cfg = config();

  if (!cfg) {
    const line = '─'.repeat(64);
    console.log(
      `\n${line}\n📅  CALENDAR PREVIEW (not added — Google Calendar not set up yet)\n` +
      `Title: ${event.summary}\n` +
      `When:  ${event.start.dateTime} → ${event.end.dateTime} (${SITE_TIMEZONE})\n${line}\n` +
      `${event.description}\n${line}\n`
    );
    return { ok: true, previewed: true };
  }

  if (cfg.error) {
    console.error('Google Calendar setup problem:', cfg.error);
    return { ok: false, error: cfg.error };
  }

  try {
    const token = await getAccessToken(cfg);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      }
    );
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const reason = (data.error && data.error.message) || `Google returned ${res.status}`;
      // 403/404 almost always means the calendar isn't shared with the robot.
      if (res.status === 403 || res.status === 404) {
        return {
          ok: false,
          error: `${reason}. Check the calendar is shared with ${cfg.email} with "Make changes to events".`,
        };
      }
      return { ok: false, error: reason };
    }

    return { ok: true, eventId: data.id };
  } catch (e) {
    console.error('Google Calendar error:', e.message);
    return { ok: false, error: e.message };
  }
}

// Deletes the gig's event from his Google Calendar. Returns
// { ok, removed?, skipped?, previewed?, error? } and never throws.
export async function removeGigFromCalendar(eventId) {
  // Gigs approved before the calendar was connected have no event to remove.
  if (!eventId) return { ok: true, skipped: true };

  const cfg = config();
  if (!cfg) {
    console.log(`\n📅  CALENDAR PREVIEW: would remove event ${eventId} (Google Calendar not set up)\n`);
    return { ok: true, previewed: true };
  }
  if (cfg.error) return { ok: false, error: cfg.error };

  try {
    const token = await getAccessToken(cfg);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    // 404/410 means he already deleted it himself - that's fine.
    if (res.ok || res.status === 404 || res.status === 410) return { ok: true, removed: true };
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: (data.error && data.error.message) || `Google returned ${res.status}` };
  } catch (e) {
    console.error('Google Calendar error:', e.message);
    return { ok: false, error: e.message };
  }
}