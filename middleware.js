import { NextResponse } from 'next/server';
import { readSessionToken, SESSION_COOKIE } from './lib/auth';

// Everything requires a signed-in user except the paths below.
// /api/cron/* has its own Bearer-token check (CRON_SECRET) so schedulers can call it.
const PUBLIC = ['/login', '/api/login', '/api/signup', '/api/logout', '/api/auth/google/', '/api/cron/'];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p.endsWith('/') ? p : p + '/'))) {
    return NextResponse.next();
  }

  const email = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (email) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', req.url));
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico).*)'],
};
