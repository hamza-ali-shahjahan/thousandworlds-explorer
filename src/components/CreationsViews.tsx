// Hash-routed overlays for saved creations:
//   #lab      → the signed-in user's own saved worlds/findings (with share/delete)
//   #gallery  → public community creations (anyone)
//   #share=<slug> → one public creation, read-only (the shareable link target)
// Inert until accounts are configured.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { listMyCreations, listPublicCreations, getCreationBySlug, setCreationPublic, deleteCreation, shareUrl } from '../lib/creations';
import { supabaseConfigured, type Creation } from '../lib/supabase';

function useHash(): string {
  const [h, setH] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setH(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const REG_COLOR: Record<string, string> = {
  Snowball: '#6fa8ff', Frozen: '#6fa8ff', Cold: '#7fcfe6', Temperate: '#46d49a', Hot: '#f0b24a', Scorching: '#e24b4a',
};

function CreationCard({ c, mine, onChange }: { c: Creation; mine?: boolean; onChange?: () => void }) {
  const p = c.payload as Record<string, any>;
  const [busy, setBusy] = useState(false);

  return (
    <div className="cc">
      <div className="cc-head"><span className="cc-type">{c.type}</span>{c.is_public && <span className="cc-pub">🌍 public</span>}</div>
      <div className="cc-title">{c.title || 'Untitled'}</div>

      {c.type === 'world' && p?.prediction && (
        <div className="cc-body">
          <span className="cc-badge" style={{ color: REG_COLOR[p.prediction.reg] || 'var(--text)' }}>{p.prediction.reg}</span>
          <span>Predicted surface ≈ <b>{Math.round(p.prediction.mean)} K</b> ({kToC(p.prediction.mean)})</span>
          {p.cousin && <span className="cc-dim">closest real world: {p.cousin}</span>}
        </div>
      )}
      {c.type === 'finding' && p?.result && (
        <div className="cc-body">
          <span className="cc-badge">{p.result.verdict}</span>
          <span><b>{Math.round((p.result.frac || 0) * 100)}%</b> of {p.result.n} sims · median {Math.round(p.result.median)} K</span>
        </div>
      )}
      {c.type === 'estimate' && (
        <div className="cc-body cc-dim">{p?.planet ?? 'a planet'}{p?.estimate?.median ? ` · ${Math.round(p.estimate.median)} K` : ''}</div>
      )}

      {mine && (
        <div className="cc-actions">
          {c.is_public && c.share_slug ? (
            <button className="linkbtn" onClick={() => navigator.clipboard?.writeText(shareUrl(c.share_slug!))}>copy link</button>
          ) : (
            <button className="linkbtn" disabled={busy} onClick={async () => { setBusy(true); await setCreationPublic(c.id, true); setBusy(false); onChange?.(); }}>share</button>
          )}
          <button className="linkbtn cc-del" disabled={busy} onClick={async () => {
            if (!window.confirm('Delete this creation?')) return;
            setBusy(true); await deleteCreation(c.id); setBusy(false); onChange?.();
          }}>delete</button>
        </div>
      )}
    </div>
  );
}

export default function CreationsViews() {
  const hash = useHash();
  const { user } = useAuth();
  const [items, setItems] = useState<Creation[]>([]);
  const [single, setSingle] = useState<Creation | null>(null);
  const [loading, setLoading] = useState(false);

  const view = hash === '#lab' ? 'lab' : hash === '#gallery' ? 'gallery' : hash.startsWith('#share=') ? 'share' : null;
  const slug = view === 'share' ? hash.slice('#share='.length) : null;

  const reload = useMemo(() => async () => {
    if (!supabaseConfigured) return;
    setLoading(true);
    if (view === 'lab') setItems(await listMyCreations());
    else if (view === 'gallery') setItems(await listPublicCreations());
    else if (view === 'share' && slug) setSingle(await getCreationBySlug(slug));
    setLoading(false);
  }, [view, slug]);

  useEffect(() => { if (view) reload(); }, [view, reload, user]);

  if (!view || !supabaseConfigured) return null;
  const close = () => { window.location.hash = ''; };
  const titleText = view === 'lab' ? 'My Lab' : view === 'gallery' ? 'Community gallery' : 'A shared world';

  return (
    <div className="cv-overlay">
      <header className="cv-top">
        <h2 className="cv-title">{titleText}</h2>
        <button className="cv-close" onClick={close} aria-label="Close">×</button>
      </header>
      <div className="cv-body">
        {loading ? (
          <div className="cv-empty">Loading…</div>
        ) : view === 'share' ? (
          single ? <div className="cv-grid"><CreationCard c={single} /></div> : <div className="cv-empty">This shared world wasn’t found (it may be private or deleted).</div>
        ) : items.length ? (
          <div className="cv-grid">{items.map((c) => <CreationCard key={c.id} c={c} mine={view === 'lab'} onChange={reload} />)}</div>
        ) : (
          <div className="cv-empty">{view === 'lab' ? 'Nothing saved yet — build a world or test a finding, then hit Save.' : 'No public creations yet — be the first to share one.'}</div>
        )}
      </div>
    </div>
  );
}
