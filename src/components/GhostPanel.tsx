import { climateCssRamp } from '../lib/climate';

// GhostPanel — the right panel's empty state drawn as a GHOST of its real
// layout: shimmering metric tiles + a dimmed Robinson-shaped climate oval +
// one plain-language prompt. The user sees WHAT a click yields before ever
// clicking, and meets the expand (dive-in) affordance early. CSS-only — no
// surface asset is fetched for a placeholder.
export default function GhostPanel({ prompt, hint }: { prompt: string; hint?: string }) {
  return (
    <section className="detail ghost" aria-label={prompt}>
      <div className="ghost-title shimmer" aria-hidden="true" />
      <div className="ghost-sub shimmer" aria-hidden="true" />
      <div className="ghost-tiles" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => <div key={i} className="ghost-tile shimmer" />)}
      </div>
      <div className="ghost-maplabel shimmer" aria-hidden="true" />
      <div className="ghost-map" aria-hidden="true">
        <div className="ghost-oval" style={{ background: climateCssRamp(215, 305) }} />
        <span className="ghost-expand">⤢</span>
      </div>
      <p className="ghost-prompt">{prompt}</p>
      {hint && <p className="ghost-hint">{hint}</p>}
      <div className="ghost-rows" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="ghost-row shimmer" />)}
      </div>
    </section>
  );
}
