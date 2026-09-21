// Turns a YouTube or Facebook video link into an embeddable player URL.
// Returns null for anything else, so random links can never be embedded.
//
// Accepted:
//   https://www.youtube.com/watch?v=ID      https://youtu.be/ID
//   https://www.youtube.com/shorts/ID       https://www.youtube.com/live/ID
//   https://www.facebook.com/.../videos/... https://www.facebook.com/reel/...
//   https://www.facebook.com/watch/?v=...
export function videoEmbed(link) {
  let url;
  try { url = new URL(String(link).trim()); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.replace(/^(www|m)\./, '');

  // YouTube. The "nocookie" domain doesn't set tracking cookies until the
  // visitor actually presses play.
  let id = null;
  let vertical = false;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const m = url.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
      if (m) { id = m[2]; vertical = m[1] === 'shorts'; }
    }
  }
  if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
    return { kind: 'youtube', src: `https://www.youtube-nocookie.com/embed/${id}`, vertical };
  }

  // Facebook. Only public videos play when embedded.
  if (host === 'facebook.com' && /\/(videos|reel|watch)\b/.test(url.pathname)) {
    vertical = url.pathname.includes('/reel');
    return {
      kind: 'facebook',
      src: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url.href)}&show_text=false`,
      vertical,
    };
  }

  return null;
}

export const MAX_VIDEOS = 6;

// Splits the admin's "one link per line" text into cleaned-up lines.
export function videoLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function venueLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30);
}

// Testimonials are stored as [{ quote, who }]. Cleans whatever comes in.
export function cleanTestimonials(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => ({
      quote: String((t && t.quote) || '').trim().slice(0, 400),
      who: String((t && t.who) || '').trim().slice(0, 100),
    }))
    .filter((t) => t.quote)
    .slice(0, 6);
}

// Reads a photo stored as a data URL ("data:image/jpeg;base64,....").
// Forgiving about how it got there: accepts "jpg" as well as "jpeg", and
// ignores line breaks or spaces that online converters sometimes add.
// Returns { type, base64 } or null if it isn't a usable photo.
//
// SVG is deliberately refused: an SVG can contain scripts, and serving one
// from the site's own address would let those scripts run.
const PHOTO_TYPES = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };

export function parsePhotoDataUrl(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!m) return null;
  const type = PHOTO_TYPES[m[1].toLowerCase()];
  if (!type) return null;
  const base64 = m[2].replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(base64) || base64.length < 100) return null;
  return { type, base64 };
}