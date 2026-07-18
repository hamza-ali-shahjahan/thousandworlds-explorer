// SignInDoor — the Explorer's hard front gate. Not dismissible: no ✕, Esc and
// backdrop are inert; the only ways forward are signing in (magic link + Google,
// the existing auth flow) or "← Back" to the landing beneath. Ported from the
// emulator's approved door; value props speak for the whole three-tab Explorer.
import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { logEvent } from '../lib/supabase';
import './SignInDoor.css';

const PROPS: { icon: React.ReactNode; text: React.ReactNode }[] = [
  {
    icon: <path d="M12 3l2.2 5.6L20 11l-5.8 2.4L12 19l-2.2-5.6L4 11l5.8-2.4L12 3" />,
    text: <>Explore <b>6,000+ real worlds</b> and 1,659 simulated climates</>,
  },
  {
    icon: <path d="M9 3h6M10 3v5l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />,
    text: <>Imagine worlds in the Lab — save and share what you build</>,
  },
  {
    icon: <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4 20h16" />,
    text: <>Physically modeled portraits, the cosmic shoreline, charts &amp; CSV</>,
  },
  {
    icon: <path d="M10 14a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.7 1.7M14 10a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.7-1.7" />,
    text: <>Your saved worlds and share links, on any device</>,
  },
];

export default function SignInDoor({ onBack }: { onBack: () => void }) {
  const { configured, signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { logEvent('door_shown'); }, []);
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    logEvent('door_cta', { method: 'magic_link' });
    const { error } = await signIn(email);
    setBusy(false);
    if (error) setErr(error); else setSent(true);
  }
  async function google() {
    setBusy(true); setErr(null);
    logEvent('door_cta', { method: 'google' });
    const { error } = await signInWithGoogle();
    if (error) { setErr(error); setBusy(false); }
  }

  return (
    <div className="modal-backdrop door-wall" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="door-title">
        <div className="modal-head"><h2 className="modal-title" id="door-title">Sign in to explore</h2></div>
        <div className="modal-body">
          <div className="door">
            <p className="door-lead">A free account — twenty seconds with Google or a magic link — and every world is yours.</p>
            <ul className="door-props">
              {PROPS.map((p, i) => (
                <li key={i}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{p.icon}</svg>
                  <span>{p.text}</span>
                </li>
              ))}
            </ul>

            {!configured ? (
              <p className="door-note">Accounts aren't configured on this build. Set the Supabase keys to enable sign-in.</p>
            ) : sent ? (
              <p className="door-note">Check <b>{email}</b> for a one-tap sign-in link.</p>
            ) : (
              <>
                <button className="btn door-google" type="button" onClick={google} disabled={busy}>
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
                    <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                  </svg>
                  Continue with Google
                </button>
                <div className="door-or"><span>or</span></div>
                <form onSubmit={submit}>
                  <input className="door-input" type="email" required placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email for sign-in link" />
                  {err && <p className="door-err">{err}</p>}
                  <button className="btn primary door-wide" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
                </form>
              </>
            )}

            <div className="door-foot">
              <button className="door-back" type="button" onClick={onBack}>← Back</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
