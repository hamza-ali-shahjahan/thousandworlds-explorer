// Header sign-in control. Renders nothing until accounts are configured, so the
// explorer is unchanged in anonymous/local mode. Passwordless magic-link sign in.
import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

export default function AuthMenu() {
  const { configured, loading, user, profile, isAdmin, signIn, signInWithGoogle, signOut } = useAuth();
  const [open, setOpen] = useState(false);   // sign-in modal
  const [menu, setMenu] = useState(false);   // signed-in dropdown
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A "Save" button anywhere can ask us to open the sign-in modal.
  useEffect(() => {
    const openSignin = () => { setOpen(true); setSent(false); setErr(null); };
    window.addEventListener('open-signin', openSignin);
    return () => window.removeEventListener('open-signin', openSignin);
  }, []);

  if (!configured || loading) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { error } = await signIn(email);
    setBusy(false);
    if (error) setErr(error); else setSent(true);
  }

  async function googleSignIn() {
    setBusy(true); setErr(null);
    const { error } = await signInWithGoogle();
    // On success the browser redirects to Google; only reachable here on error.
    if (error) { setErr(error); setBusy(false); }
  }

  if (!user) {
    return (
      <>
        <button className="auth-btn" onClick={() => { setOpen(true); setSent(false); setErr(null); }}>
          Sign in
        </button>
        {open && (
          <div className="auth-scrim" onClick={() => setOpen(false)}>
            <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
              <button className="auth-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
              <h3 className="auth-h">Sign in to save &amp; share</h3>
              {sent ? (
                <p className="auth-sub">Check <b>{email}</b> for a one-tap sign-in link. You can close this.</p>
              ) : (
                <>
                  <p className="auth-sub">One tap with Google, or we email you a secure link. Browsing stays anonymous unless you sign in.</p>
                  <button className="auth-google" type="button" onClick={googleSignIn} disabled={busy}>
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                      <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                    </svg>
                    Continue with Google
                  </button>
                  <div className="auth-or"><span>or</span></div>
                  <form onSubmit={submit}>
                    <input
                      className="auth-input" type="email" required autoFocus placeholder="you@email.com"
                      value={email} onChange={(e) => setEmail(e.target.value)}
                    />
                    {err && <p className="auth-err">{err}</p>}
                    <button className="auth-go" type="submit" disabled={busy}>
                      {busy ? 'Sending…' : 'Email me a link'}
                    </button>
                  </form>
                  <p className="auth-fine">By signing in you agree we store your email and the worlds you save. See the privacy note in the README.</p>
                </>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  const label = profile?.display_name || user.email || 'Account';
  return (
    <div className="auth-wrap">
      <button className="auth-btn" onClick={() => setMenu((m) => !m)}>
        {label.length > 22 ? label.slice(0, 20) + '…' : label} ▾
      </button>
      {menu && (
        <div className="auth-drop" onMouseLeave={() => setMenu(false)}>
          <a className="auth-item" href="#lab" onClick={() => setMenu(false)}>My Lab</a>
          <a className="auth-item" href="#gallery" onClick={() => setMenu(false)}>Community gallery</a>
          {isAdmin && <a className="auth-item" href="#admin" onClick={() => setMenu(false)}>Admin dashboard</a>}
          <button className="auth-item" onClick={() => { setMenu(false); void signOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
