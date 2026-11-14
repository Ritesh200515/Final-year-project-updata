import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (router.query.error) setError(String(router.query.error));
  }, [router.query.error]);
  const isSignup = mode === 'signup';

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(isSignup ? '/api/signup' : '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Something went wrong');
        setLoading(false);
        return;
      }
      router.push('/');
    } catch (err) {
      setError('Something went wrong. Try again.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>{isSignup ? 'Create account' : 'Sign in'} — iBase Poster</title>
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,500;0,600;0,700;1,500&family=Inter:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </Head>
      <div className="wrap">
        <form className="card" onSubmit={handleSubmit}>
          <div className="mark">iB</div>
          <h1>iBase Poster</h1>
          <p className="sub">{isSignup ? 'Create your account.' : 'Sign in to continue.'}</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            autoFocus
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isSignup ? 'Password (8+ characters)' : 'Password'}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading || !email || !password}>
            {loading ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
          <div className="or"><span>or</span></div>
          <a className="google-btn" href="/api/auth/google/start">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
              <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z"/>
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
            </svg>
            Continue with Google
          </a>
          <p className="switch">
            {isSignup ? 'Already have an account? ' : 'Need an account? '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setError('');
                setMode(isSignup ? 'login' : 'signup');
              }}
            >
              {isSignup ? 'Sign in' : 'Create one'}
            </a>
          </p>
        </form>
      </div>
      <style jsx>{`
        .wrap {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #122b4f;
          font-family: 'Inter', sans-serif;
        }
        .card {
          background: #f6f4ec;
          border-radius: 10px;
          padding: 36px 32px;
          width: 320px;
          box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        }
        .mark {
          width: 40px;
          height: 40px;
          border-radius: 6px;
          background: #2f8f5b;
          color: #f6f4ec;
          font-family: 'Newsreader', serif;
          font-style: italic;
          font-weight: 700;
          font-size: 17px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
        }
        h1 {
          font-family: 'Newsreader', serif;
          font-style: italic;
          font-weight: 600;
          font-size: 24px;
          margin: 0 0 6px;
          color: #1b1611;
        }
        .sub {
          font-size: 13.5px;
          color: #6b6150;
          margin: 0 0 20px;
        }
        input {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border: 1px solid #d8d2c2;
          border-radius: 6px;
          font-size: 14px;
          font-family: 'Inter', sans-serif;
          margin-bottom: 12px;
        }
        input:focus {
          outline: none;
          border-color: #2f8f5b;
        }
        .error {
          color: #b5482f;
          font-size: 13px;
          margin: -4px 0 12px;
        }
        button {
          width: 100%;
          padding: 10px 12px;
          border: none;
          border-radius: 6px;
          background: #2f8f5b;
          color: #f6f4ec;
          font-family: 'Inter', sans-serif;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .or {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 16px 0;
          font-size: 12px;
          color: #8a8068;
        }
        .or::before,
        .or::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #d8d2c2;
        }
        .google-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 9px 12px;
          border: 1px solid #d8d2c2;
          border-radius: 6px;
          background: #fff;
          color: #1b1611;
          font-weight: 600;
          font-size: 14px;
          text-decoration: none;
        }
        .google-btn:hover {
          background: #faf8f2;
        }
        .switch {
          text-align: center;
          font-size: 13px;
          color: #6b6150;
          margin: 16px 0 0;
        }
        .switch a {
          color: #2f8f5b;
          font-weight: 600;
          text-decoration: none;
        }
        .switch a:hover {
          text-decoration: underline;
        }
      `}</style>
    </>
  );
}
