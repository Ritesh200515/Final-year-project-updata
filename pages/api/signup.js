import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail } from '../../lib/db';
import { makeSessionToken, sessionCookie } from '../../lib/auth';

// This app can publish to the company's social accounts, so only approved emails may sign up.
// Approved = listed in ALLOWED_EMAILS (or GOOGLE_ALLOWED_EMAILS): comma-separated exact emails and/or "@domain.com" entries.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { email, password } = req.body || {};

  const allowed = (process.env.ALLOWED_EMAILS || process.env.GOOGLE_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return res.status(403).json({ ok: false, error: 'Signup is disabled (no allowed emails are set)' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email' });
  const lower = email.toLowerCase().trim();
  if (!allowed.some((e) => (e.startsWith('@') ? lower.endsWith(e) : lower === e))) {
    return res.status(403).json({ ok: false, error: 'This email is not allowed to create an account' });
  }
  if (!password || password.length < 8) return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });

  try {
    if (await getUserByEmail(email)) return res.status(409).json({ ok: false, error: 'An account with this email already exists' });
    const user = await createUser(email, await bcrypt.hash(password, 10));
    res.setHeader('Set-Cookie', sessionCookie(await makeSessionToken(user.email)));
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Could not create account. Try again.' });
  }
}
