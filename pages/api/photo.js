import { getSupabase } from '../../lib/supabaseAdmin';
import { parsePhotoDataUrl } from '../../lib/media';

// Serves his profile photo as a real image file. Share previews on Facebook
// and Messenger need an image URL - they can't read a photo stored inside the
// page as text. The page also uses this instead of embedding the photo, which
// makes it lighter to load.
export default async function handler(req, res) {
  try {
    const { data, error } = await getSupabase().from('profile').select('photo').eq('id', 1).maybeSingle();
    if (error) {
      console.error('Photo: could not read profile:', error.message);
      return res.status(500).end();
    }

    const photo = parsePhotoDataUrl(data && data.photo);
    if (!photo) {
      console.warn('Photo: the stored photo is missing or not a usable image. Re-upload it in /admin → Profile.');
      return res.status(404).end();
    }

    res.setHeader('Content-Type', photo.type);
    // The page links here with ?v=<fingerprint of the photo>, so when the
    // photo changes the address changes too, and it's safe to cache long.
    res.setHeader('Cache-Control', req.query.v
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=300');
    res.send(Buffer.from(photo.base64, 'base64'));
  } catch (e) {
    console.error('Photo:', e.message);
    res.status(500).end();
  }
}