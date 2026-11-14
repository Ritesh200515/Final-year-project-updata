// Edge-safe (Web Crypto only): imported by middleware.js, which runs on the Edge runtime.
// Session = "<base64url email>.<expiry ms>.<HMAC-SHA256 signature>", signed with AUTH_SECRET.
// Nothing is stored server-side; changing AUTH_SECRET logs everyone out.

const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'ibase_session';
export const SESSION_MAX_AGE = SESSION_MS / 1000;

const enc = new TextEncoder();
const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

async function sign(payload) {
  if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is not set');
  const key = await crypto.subtle.importKey('raw', enc.encode(process.env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeSessionToken(email) {
  const payload = `${b64u(email)}.${Date.now() + SESSION_MS}`;
  return `${payload}.${await sign(payload)}`;
}

// Returns the signed-in user's email, or null if the token is missing, forged or expired.
export async function readSessionToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [emailPart, expiry, sig] = parts;
  try {
    if (!safeEqual(sig, await sign(`${emailPart}.${expiry}`))) return null;
    if (Number(expiry) < Date.now()) return null;
    return unb64u(emailPart);
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secure}`;
}
