// Header sign-in control. Renders nothing until accounts are configured, so the
// explorer is unchanged in anonymous/local mode. Passwordless magic-link sign in.
import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';

export default function AuthMenu() {
  const { configured, loading, user, profile, isAdmin, signIn, signOut } = useAuth();
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
                  <p className="auth-sub">No password — we email you a secure link. Browsing stays anonymous unless you sign in.</p>
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
