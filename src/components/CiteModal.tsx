import { useEffect, useState } from 'react';
import Modal from './Modal';
import { APP_VERSION } from '../lib/version';
import './CiteModal.css';

// "Cite this" — everything a researcher/journalist needs to reference the app
// or its sources: the Explorer itself, the ThousandWorlds benchmark BibTeX
// (verbatim from the paper), the NASA archive acknowledgment, and the exact
// data snapshot this deployment serves. One copy button per block.

const SITE_URL = 'https://thousandworldsexplorer.com';

// Benchmark BibTeX — kept byte-identical to the citation block in README.md.
const BENCHMARK_BIBTEX = `@article{thousandworlds2026,
  title  = {ThousandWorlds: A benchmark for climate emulation of potentially habitable exoplanets},
  author = {Stevenson, Edward T. and Mak, Mei Ting and Wolf, Eric and Sergeev, Denis E. and Hammond, Tobi and Mayne, N. J. and Cranmer, Miles},
  year   = {2026},
  eprint = {2606.18338},
  archivePrefix = {arXiv},
  doi    = {10.48550/arXiv.2606.18338}
}`;

// Required acknowledgment wording from the NASA Exoplanet Archive.
const NASA_ACK =
  'This research has made use of the NASA Exoplanet Archive, which is operated by Caltech, under contract with NASA under the Exoplanet Exploration Program.';

// Clipboard write with a select+execCommand fallback for older/permissionless contexts.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }
}

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const onCopy = () => {
    copyText(text).then((ok) => {
      setState(ok ? 'ok' : 'fail');
      window.setTimeout(() => setState('idle'), 1600);
    });
  };
  return (
    <button className="cite-copy" onClick={onCopy} aria-label={label}>
      {state === 'ok' ? '✓ Copied' : state === 'fail' ? 'Copy failed' : 'Copy'}
    </button>
  );
}

export default function CiteModal({ onClose }: { onClose: () => void }) {
  const [snap, setSnap] = useState<{ generated: string; total: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/meta.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => { if (live && m?.generated && typeof m.total === 'number') setSnap({ generated: m.generated, total: m.total }); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const accessed = new Date().toISOString().slice(0, 10);
  const snapDate = snap ? snap.generated.slice(0, 10) : null;
  const explorerCite =
    `Shahjahan, Hamza Ali. ThousandWorlds Explorer (v${APP_VERSION}) [software]. ${SITE_URL}. Accessed ${accessed}.`;

  return (
    <Modal title="Cite this" onClose={onClose} labelledBy="cite-title">
      <div className="cite">
        <section className="cite-sec">
          <div className="cite-h">The Explorer (this app)</div>
          <div className="cite-row">
            <pre className="cite-block">{explorerCite}</pre>
            <CopyBtn text={explorerCite} label="Copy the Explorer citation" />
          </div>
        </section>

        <section className="cite-sec">
          <div className="cite-h">The ThousandWorlds benchmark <span className="cite-sub">— the 1,659 simulated climates</span></div>
          <div className="cite-row">
            <pre className="cite-block cite-bibtex">{BENCHMARK_BIBTEX}</pre>
            <CopyBtn text={BENCHMARK_BIBTEX} label="Copy the benchmark BibTeX" />
          </div>
        </section>

        <section className="cite-sec">
          <div className="cite-h">NASA Exoplanet Archive <span className="cite-sub">— the discovered planets</span></div>
          <div className="cite-row">
            <pre className="cite-block">{NASA_ACK}</pre>
            <CopyBtn text={NASA_ACK} label="Copy the NASA archive acknowledgment" />
          </div>
        </section>

        <div className="cite-meta">
          App v{APP_VERSION}
          {snap && snapDate && <> · NASA archive snapshot {snapDate} · {snap.total.toLocaleString()} planets</>}
        </div>
      </div>
    </Modal>
  );
}
