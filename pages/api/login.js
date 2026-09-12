import { checkPassword, makeToken, rateLimit, clientIp } from '../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!rateLimit('login:' + clientIp(req), { max: 8, windowMs: 10 * 60 * 1000 })) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  try {
    if (!checkPassword(req.body && req.body.password)) {
      // Small delay so failures aren't instant, which slows down scripted guessing.
      await new Promise((r) => setTimeout(r, 400));
      return res.status(401).json({ error: 'Wrong password' });
    }
    return res.status(200).json({ token: makeToken() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}