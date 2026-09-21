import { getSupabase } from '../../lib/supabaseAdmin';
import { requireAdmin } from '../../lib/auth';
import { videoEmbed, videoLines, venueLines, cleanTestimonials, MAX_VIDEOS, parsePhotoDataUrl } from '../../lib/media';

export const DEFAULT_PROFILE = {
  id: 1,
  name: 'Rene Calloway',
  tagline: 'Warm tenor and soprano sax for weddings, clubs, cocktail hours and private events.',
  bio: 'Ten years playing clubs, weddings and private parties around town — from slow, smoky ballads to a horn line that gets a dance floor moving.',
  email: 'hello@example.com',
  instagram: '@renecalloway.sax',
  photo: '',
  buffer_minutes: 60,
  videos: '',
  venues: '',
  testimonials: [],
};

// Plain text columns that can be written, with their maximum lengths.
// Spreading the request body straight into upsert() would let anyone who
// got hold of a token write to columns you didn't intend, including id.
const TEXT_FIELDS = {
  name: 200,
  tagline: 400,
  bio: 4000,
  email: 200,
  instagram: 300,
  photo: 3_000_000, // base64 data URL, roughly 2MB of image
};

// Next.js allows 1MB request bodies by default; a photo can be bigger.
export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

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

      for (const [field, max] of Object.entries(TEXT_FIELDS)) {
        if (body[field] == null) continue;
        const value = String(body[field]);
        if (value.length > max) return res.status(400).json({ error: `${field} is too long.` });
        if (field === 'photo' && value && !parsePhotoDataUrl(value)) {
          return res.status(400).json({ error: 'Photo must be a JPEG, PNG, WebP, GIF or AVIF image.' });
        }
        update[field] = value;
      }

      if (body.buffer_minutes != null) {
        const n = Number(body.buffer_minutes);
        if (!Number.isFinite(n) || n < 0 || n > 480) {
          return res.status(400).json({ error: 'Minutes between gigs must be between 0 and 480.' });
        }
        update.buffer_minutes = Math.round(n);
      }

      if (body.videos != null) {
        const lines = videoLines(body.videos);
        if (lines.length > MAX_VIDEOS) {
          return res.status(400).json({ error: `Add up to ${MAX_VIDEOS} videos.` });
        }
        const bad = lines.find((l) => !videoEmbed(l));
        if (bad) {
          return res.status(400).json({ error: `This isn't a YouTube or Facebook video link: ${bad.slice(0, 80)}` });
        }
        update.videos = lines.join('\n');
      }

      if (body.venues != null) update.venues = venueLines(body.venues).map((v) => v.slice(0, 80)).join('\n');
      if (body.testimonials != null) update.testimonials = cleanTestimonials(body.testimonials);

      const { error } = await supabase.from('profile').upsert(update);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}