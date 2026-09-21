import { getSupabase } from '../../lib/supabaseAdmin';
import { requireAdmin } from '../../lib/auth';
import { getBusyCalendar } from '../../lib/ics';
import { getBufferMinutes } from '../../lib/slots';

function isValidDateKey(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data: dateRows, error } = await supabase.from('dates').select('*');
      if (error) return res.status(500).json({ error: error.message });

      const manual = {};
      (dateRows || []).forEach((row) => { manual[row.date] = row.status; });

      // Approved gigs become busy time ranges. Only the times go to the
      // browser - never the client name, venue or contact details.
      const { data: approved } = await supabase
        .from('requests')
        .select('date, start_time, end_time')
        .eq('status', 'approved');

      const ranges = {};
      (approved || []).forEach((r) => {
        if (!r.start_time || !r.end_time) return;
        if (!ranges[r.date]) ranges[r.date] = [];
        ranges[r.date].push({ start: r.start_time, end: r.end_time });
      });

      const calendar = await getBusyCalendar();
      for (const [date, list] of Object.entries(calendar.ranges || {})) {
        if (!ranges[date]) ranges[date] = [];
        ranges[date].push(...list);
      }

      // Once an approved gig is in his Google Calendar, the calendar feed
      // reports it too - drop the duplicate, then sort for display.
      for (const [date, list] of Object.entries(ranges)) {
        const seen = new Set();
        ranges[date] = list
          .filter((r) => { const k = r.start + '-' + r.end; if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((a, b) => a.start.localeCompare(b.start));
      }

      return res.status(200).json({
        manual,
        busyDays: calendar.days || [],
        ranges,
        bufferMinutes: await getBufferMinutes(supabase),
      });
    }

    if (req.method === 'POST') {
      if (!requireAdmin(req, res)) return;

      const date = String((req.body && req.body.date) || '');
      if (!isValidDateKey(date)) return res.status(400).json({ error: 'Invalid date' });

      // Toggles a whole-day block on or off. Individual gigs come from
      // approved requests, not from here.
      const { data: existing } = await supabase.from('dates').select('*').eq('date', date).maybeSingle();
      if (!existing) {
        await supabase.from('dates').upsert({ date, status: 'blocked' });
      } else {
        await supabase.from('dates').delete().eq('date', date);
      }
      return res.status(200).json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}