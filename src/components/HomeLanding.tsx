import { useEffect, useRef, useState } from 'react';
import { track } from '../lib/track';
import './HomeLanding.css';

// HomeLanding — the Explorer's public front door at the root. Anonymous
// visitors see this instead of the app: pitch, six real screenshots,
// credibility strip in the first fold, one CTA that raises the sign-in door.
// Ported from the emulator's approved landing; copy speaks for the three tabs.
// Screenshots live at /shots/<name>.jpg; a card that 404s keeps its framed
// background and shows the caption as text — never a broken icon.

const SHOTS: { file: string; caption: string }[] = [
  { file: 'portrait.jpg', caption: 'Physically modeled portraits of real worlds — not artist’s concepts' },
  { file: 'simulated.jpg', caption: '1,659 simulated climates across five global climate models' },
  { file: 'shoreline.jpg', caption: 'The cosmic shoreline — which worlds keep their air, with JWST verdicts' },
  { file: 'lab.jpg', caption: 'Imagine a world — an honest, physics-grounded lab' },
  { file: 'charts.jpg', caption: 'Charts, tables, CSV — a serious analysis tool underneath' },
];

function Shot({ file, caption }: { file: string; caption: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="shot">
      <div className="shot-frame">
        {failed
          ? <span className="shot-alt">{caption}</span>
          : <img src={`/shots/${file}`} alt={caption} loading="lazy" onError={() => setFailed(true)} />}
      </div>
      <figcaption className="shot-cap">{caption}</figcaption>
    </figure>
  );
}

// One big screenshot at a time — scroll-snap carousel, no library. Swipe,
// arrows, dots, arrow keys; no auto-advance (respect the reader).
function Gallery() {
  const trackRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const goTo = (i: number) => {
    const el = trackRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(SHOTS.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: 'smooth' });
  };
  const onScroll = () => {
    const el = trackRef.current;
    if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth));
  };
  return (
    <section className="l-carousel" aria-label="What you'll see inside" aria-roledescription="carousel">
      <div
        className="l-track" ref={trackRef} onScroll={onScroll} tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') goTo(idx + 1); else if (e.key === 'ArrowLeft') goTo(idx - 1); }}
      >
        {SHOTS.map((s) => <Shot key={s.file} {...s} />)}
      </div>
      <button className="l-nav l-prev" aria-label="Previous screenshot" onClick={() => goTo(idx - 1)} disabled={idx === 0}>‹</button>
      <button className="l-nav l-next" aria-label="Next screenshot" onClick={() => goTo(idx + 1)} disabled={idx === SHOTS.length - 1}>›</button>
      <div className="l-dots" aria-hidden="true">
        {SHOTS.map((s, i) => (
          <button key={s.file} className={`l-dot${i === idx ? ' on' : ''}`} tabIndex={-1} onClick={() => goTo(i)} />
        ))}
      </div>
    </section>
  );
}

export default function HomeLanding({ onLaunch }: { onLaunch: () => void }) {
  useEffect(() => { track('landing_view'); }, []);
  return (
    <div className="landing">
      <main className="landing-inner">
        <section className="l-hero">
          <p className="l-kicker l-brand"><b>Thousand</b>Worlds <span className="l-brand-x">Explorer</span></p>
          <h1 className="l-h1">Every confirmed exoplanet — and the climates they might have</h1>
          <p className="l-sub">
            Explore 6,000+ real worlds from the NASA Exoplanet Archive, dive into simulated
            climates from five global climate models, and imagine new worlds in an honest,
            physics-grounded lab.
          </p>
          <section className="l-cred" aria-label="Provenance">
            <a
              className="l-cred-item" href="https://arxiv.org/abs/2606.18338"
              target="_blank" rel="noreferrer"
            >Built on the ThousandWorlds benchmark</a>
            <span className="l-cred-item">1,659 GCM simulations · 5 climate models</span>
            <span className="l-cred-item">Runs in your browser — nothing leaves your machine</span>
          </section>
          <button className="btn primary l-cta" type="button" onClick={() => { track('landing_cta'); onLaunch(); }}>
            Launch the explorer →
          </button>
        </section>

        <Gallery />

        <p className="l-note">Research-grade data, honestly framed — for exploration and education.</p>
      </main>

      <footer className="sitefoot l-foot">
        <span className="l-foot-side">
          <a href="https://github.com/hamza-ali-shahjahan/thousandworlds-explorer" target="_blank" rel="noreferrer">open source</a>
        </span>
        <span className="l-foot-mid">
          Built with <span className="foot-heart" aria-label="love">❤️</span> using{' '}
          <a href="https://github.com/hamza-ali-shahjahan/hamzaish" target="_blank" rel="noreferrer">/hamzaish</a>
        </span>
        <span className="l-foot-side l-legal">
          <a href="/privacy">Privacy policy</a>
          {' · '}
          <a href="/terms">Terms</a>
        </span>
      </footer>
    </div>
  );
}
