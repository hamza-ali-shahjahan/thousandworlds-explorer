// Reusable "Save to my Lab" + "Share publicly" control, dropped beside each
// creation's existing export button. Hidden entirely until accounts are
// configured; prompts sign-in (via the header menu) when signed out.
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { saveCreation, setCreationPublic, shareUrl, type SaveInput } from '../lib/creations';
import { supabaseConfigured } from '../lib/supabase';

export default function SaveShareBar({ type, title, buildPayload }: {
  type: SaveInput['type'];
  title: string;
  buildPayload: () => Record<string, unknown>;
}) {
  const { user } = useAuth();
  const [savedId, setSavedId] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!supabaseConfigured) return null;

  const save = async () => {
    if (!user) { window.dispatchEvent(new Event('open-signin')); return; }
    setBusy(true); setErr(null);
    const { data, error } = await saveCreation({ type, title: title.slice(0, 140), payload: buildPayload() });
    setBusy(false);
    if (error) setErr(error); else if (data) setSavedId(data.id);
  };

  const share = async () => {
    if (!savedId) return;
    setBusy(true); setErr(null);
    const { slug: s, error } = await setCreationPublic(savedId, true);
    setBusy(false);
    if (error) { setErr(error); return; }
    if (s) {
      setSlug(s);
      navigator.clipboard?.writeText(shareUrl(s)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
    }
  };

  return (
    <div className="ssb">
      {!savedId ? (
        <button className="ssb-btn" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : user ? '♥ Save to my Lab' : '♥ Sign in to save'}
        </button>
      ) : !slug ? (
        <>
          <span className="ssb-ok">Saved ✓</span>
          <button className="ssb-btn" onClick={share} disabled={busy}>{busy ? '…' : '🌍 Share publicly'}</button>
        </>
      ) : (
        <span className="ssb-ok">{copied ? 'Public · link copied ✓' : 'Public — share link ready'}</span>
      )}
      {err && <span className="ssb-err">{err}</span>}
    </div>
  );
}
