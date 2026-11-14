import crypto from 'crypto';

// Step 1 of "Continue with Google": send the browser to Google, with a random `state`
// remembered in a short-lived cookie so the callback can prove the request came from us.
export default function handler(req, res) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REDIRECT_URI) {
    return res.redirect(302, '/login?error=' + encodeURIComponent('Google login is not configured'));
  }
  const state = crypto.randomBytes(16).toString('hex');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `g_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${secure}`);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
