import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail } from '../../../../lib/db';
import { makeSessionToken, sessionCookie } from '../../../../lib/auth';

function fail(res, message) {
  res.setHeader('Set-Cookie', 'g_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.redirect(302, '/login?error=' + encodeURIComponent(message));
}

// GOOGLE_ALLOWED_EMAILS: comma-separated list of exact emails and/or "@domain.com" entries.
function isAllowed(email) {
  const list = (process.env.GOOGLE_ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.some((entry) => (entry.startsWith('@') ? email.endsWith(entry) : email === entry));
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  if (error) return fail(res, 'Google sign-in was cancelled');

  const cookieState = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('g_state='))?.slice(8);
  if (!code || !state || !cookieState || state !== cookieState) return fail(res, 'Sign-in expired. Please try again.');

  try {
    // Exchange the one-time code for tokens (server-to-server, so Google's reply can be trusted).
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.access_token) throw new Error(tokens.error_description || 'Token exchange failed');

    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoRes.json();
    if (!infoRes.ok || !info.email) throw new Error('Could not read Google profile');
    if (!info.email_verified) return fail(res, 'Your Google email is not verified');

    const email = info.email.toLowerCase();
    let user = await getUserByEmail(email);

    // Not every Google account may enter: either the email already has an account here,
    // or it is on the GOOGLE_ALLOWED_EMAILS list.
    if (!user) {
      if (!isAllowed(email)) return fail(res, `${email} is not allowed to use this app`);
      // Random unusable password: this account signs in with Google only.
      user = await createUser(email, await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10));
    }

    res.setHeader('Set-Cookie', [
      sessionCookie(await makeSessionToken(user.email)),
      'g_state=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax',
    ]);
    res.redirect(302, '/');
  } catch (err) {
    console.error(err);
    // While developing locally, show the real reason on the login page to make setup problems easy to spot.
    const detail = process.env.NODE_ENV !== 'production' ? ` (${String(err.message || err.code || err).slice(0, 160)})` : '';
    fail(res, 'Google sign-in failed. Please try again.' + detail);
  }
}
