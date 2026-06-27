import { useState } from 'react';

// Shown only on narrow viewports (CSS-gated): the maps + Imagine Lab are built
// for a wide screen, so we nudge phone visitors toward desktop. Dismissible.
export default function MobileNotice() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div className="mobile-notice">
      <span>📱 Best experienced on a <b>desktop</b> — the maps and Imagine Lab are built for a wide screen.</span>
      <button onClick={() => setHidden(true)} aria-label="Dismiss">×</button>
    </div>
  );
}
