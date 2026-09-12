import { getSupabase } from '../../lib/supabaseAdmin';
import { requireAdmin } from '../../lib/auth';

const DEFAULT_PROFILE = {
  id: 1,
  name: 'Rene Calloway',
  tagline: 'Warm tenor and soprano sax for weddings, clubs, cocktail hours and private events.',
  bio: 'Ten years playing clubs, weddings and private parties around town — from slow, smoky ballads to a horn line that gets a dance floor moving.',
  email: 'hello@example.com',
  instagram: '@renecalloway.sax',
  rate: 'Starting at $300/set',
  photo: '',
  buffer_minutes: 60,
};

// Only these columns can ever be written, and only up to these lengths.
// Spreading the request body straight into upsert() would let anyone who
// got hold of a token write to columns you didn't intend, including id.
const FIELDS = {
  name: 200,
  tagline: 400,
  bio: 4000,
  email: 200,
  instagram: 300,
  rate: 200,
  photo: 3_000_000, // base64 data URL, roughly 2MB of image
  buffer_minutes: 4,
};

export default async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase.from('profile').select('*').eq('id', 1).maybeSingle();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json(data || DEFAULT_PROFILE);
    }

    if (req.method === 'PUT') {
      if (!requireAdmin(req, res)) return;

      const body = req.body || {};
      const update = { id: 1 };

      for (const [field, max] of Object.entries(FIELDS)) {
        if (body[field] == null) continue;
        const value = String(body[field]);
        if (value.length > max) {
          return res.status(400).json({ error: `${field} is too long.` });
        }
        if (field === 'photo' && value && !value.startsWith('data:image/')) {
          return res.status(400).json({ error: 'Photo must be an image.' });
        }
        if (field === 'buffer_minutes') {
          const n = Number(value);
          if (!Number.isFinite(n) || n < 0 || n > 480) {
            return res.status(400).json({ error: 'Buffer must be between 0 and 480 minutes.' });
          }
          update[field] = Math.round(n);
          continue;
        }
        update[field] = value;
      }

      const { error } = await supabase.from('profile').upsert(update);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}