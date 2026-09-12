import { getSupabase } from '../../lib/supabaseAdmin';
import { requireAdmin, rateLimit, clientIp } from '../../lib/auth';
import { getBusyCalendar } from '../../lib/ics';
import { addDays } from '../../lib/timezone';
import {
  isValidTime, rangeProblem, findClash, formatRange, getBufferMinutes,
} from '../../lib/slots';

const LIMITS = { name: 120, email: 200, phone: 40, type: 60, message: 2000 };
const EVENT_TYPES = ['Wedding', 'Private party', 'Corporate event', 'Club / bar gig', 'Other'];

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function isValidDateKey(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Everything already taking up time on the given date and the days either
// side, so a gig running past midnight is accounted for.
async function busyAround(supabase, date, { ignoreRequestId } = {}) {
  const window = [addDays(date, -1), date, addDays(date, 1)];

  let query = supabase
    .from('requests')
    .select('id, date, start_time, end_time')
    .eq('status', 'approved')
    .in('date', window);
  const { data: approved } = await query;

  const ranges = {};
  (approved || []).forEach((r) => {
    if (ignoreRequestId && r.id === ignoreRequestId) return;
    if (!r.start_time || !r.end_time) return;
    if (!ranges[r.date]) ranges[r.date] = [];
    ranges[r.date].push({ start: r.start_time, end: r.end_time });
  });

  const calendar = await getBusyCalendar();
  for (const key of window) {
    for (const range of (calendar.ranges || {})[key] || []) {
      if (!ranges[key]) ranges[key] = [];
      ranges[key].push(range);
    }
  }

  return { ranges, fullDays: new Set(calendar.days || []) };
}

async function dayIsBlocked(supabase, date, fullDays) {
  if (fullDays.has(date)) return true;
  const { data } = await supabase.from('dates').select('status').eq('date', date).maybeSingle();
  return !!data;
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      if (!requireAdmin(req, res)) return;
      const { data, error } = await supabase
        .from('requests')
        .select('*')
        .order('date', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || []);
    }

    // Public endpoint - anyone can hit this, so rate limit and validate hard.
    if (req.method === 'POST') {
      if (!rateLimit('book:' + clientIp(req), { max: 10, windowMs: 60 * 60 * 1000 })) {
        return res.status(429).json({ error: 'Too many requests from here. Try again later.' });
      }

      const body = req.body || {};
      const date = clean(body.date, 10);
      const name = clean(body.name, LIMITS.name);
      const email = clean(body.email, LIMITS.email);
      const phone = clean(body.phone, LIMITS.phone);
      const message = clean(body.message, LIMITS.message);
      const rawType = clean(body.type, LIMITS.type);
      const type = EVENT_TYPES.includes(rawType) ? rawType : 'Other';
      const startTime = clean(body.start_time, 5);
      const endTime = clean(body.end_time, 5);

      if (!isValidDateKey(date)) return res.status(400).json({ error: 'Invalid date' });
      if (!name) return res.status(400).json({ error: 'Name is required' });
      if (!looksLikeEmail(email)) return res.status(400).json({ error: 'A valid email is required' });
      if (!isValidTime(startTime) || !isValidTime(endTime)) {
        return res.status(400).json({ error: 'Please give a start and end time.' });
      }

      const range = { start: startTime, end: endTime };
      const problem = rangeProblem(range);
      if (problem) return res.status(400).json({ error: problem });

      const buffer = await getBufferMinutes(supabase);
      const { ranges, fullDays } = await busyAround(supabase, date);

      if (await dayIsBlocked(supabase, date, fullDays)) {
        return res.status(409).json({ error: 'That whole day is unavailable.' });
      }

      const clash = findClash(range, date, ranges, buffer);
      if (clash) {
        return res.status(409).json({
          error: `That overlaps a gig already booked (${formatRange(clash)}). He also needs ${buffer} minutes between gigs.`,
        });
      }

      const { error } = await supabase.from('requests').insert({
        date, name, email, phone, type, message,
        start_time: startTime, end_time: endTime,
        status: 'pending',
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'PATCH') {
      if (!requireAdmin(req, res)) return;
      const { id, status } = req.body || {};
      if (!['approved', 'declined'].includes(status)) return res.status(400).json({ error: 'Invalid status' });

      const { data: reqRow, error: fetchErr } = await supabase.from('requests').select('*').eq('id', id).maybeSingle();
      if (fetchErr || !reqRow) return res.status(404).json({ error: 'Request not found' });

      if (status === 'declined') {
        await supabase.from('requests').update({ status: 'declined' }).eq('id', id);
        return res.status(200).json({ ok: true });
      }

      // Re-check on approval. Two people can have overlapping pending
      // requests, and he shouldn't be able to approve both by accident.
      const range = { start: reqRow.start_time, end: reqRow.end_time };
      if (!isValidTime(range.start) || !isValidTime(range.end)) {
        return res.status(400).json({ error: 'This request has no usable time slot.' });
      }

      const buffer = await getBufferMinutes(supabase);
      const { ranges, fullDays } = await busyAround(supabase, reqRow.date, { ignoreRequestId: id });

      if (fullDays.has(reqRow.date)) {
        return res.status(409).json({ error: 'That day is blocked on the Google Calendar.' });
      }

      const clash = findClash(range, reqRow.date, ranges, buffer);
      if (clash) {
        return res.status(409).json({
          error: `Can't approve - this clashes with a gig already booked (${formatRange(clash)}), allowing ${buffer} minutes between gigs.`,
        });
      }

      await supabase.from('requests').update({ status: 'approved' }).eq('id', id);

      // Auto-decline only the pending requests that now genuinely clash -
      // other slots on the same day stay open for consideration.
      const { data: others } = await supabase
        .from('requests')
        .select('id, date, start_time, end_time')
        .eq('status', 'pending')
        .in('date', [addDays(reqRow.date, -1), reqRow.date, addDays(reqRow.date, 1)]);

      const approvedByDate = { [reqRow.date]: [range] };
      for (const other of others || []) {
        if (other.id === id) continue;
        if (!isValidTime(other.start_time) || !isValidTime(other.end_time)) continue;
        const otherRange = { start: other.start_time, end: other.end_time };
        if (findClash(otherRange, other.date, approvedByDate, buffer)) {
          await supabase.from('requests').update({ status: 'declined' }).eq('id', other.id);
        }
      }

      return res.status(200).json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}