import bcrypt from 'bcryptjs';
import { getUserByEmail } from '../../lib/db';
import { makeSessionToken, sessionCookie } from '../../lib/auth';

// A fixed hash to compare against when the email doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required' });

  try {
    const user = await getUserByEmail(email);
    const match = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !match) return res.status(401).json({ ok: false, error: 'Incorrect email or password' });

    res.setHeader('Set-Cookie', sessionCookie(await makeSessionToken(user.email)));
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: 'Could not sign in. Try again.' });
  }
}
