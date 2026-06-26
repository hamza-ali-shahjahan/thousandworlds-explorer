import { useMemo, useState } from 'react';
import Modal from './Modal';
import SaveShareBar from './SaveShareBar';
import './FindingForge.css';
import type { TwWorld } from './ThousandWorlds';
import type { World } from '../types';
import { REGIMES, matchSims, testClaim, regimeOf, HIST_MIN, HIST_MAX, HIST_BINS } from '../lib/finding';
import type { Conditions, Regime, TestResult, Verdict } from '../lib/finding';

const REG_COLOR: Record<Regime, string> = { Frozen: '#6fa8ff', Cold: '#7fcfe6', Temperate: '#46d49a', Hot: '#f0b24a', Scorching: '#e24b4a' };
const kToC = (k: number) => `${Math.round(k - 273.15)} °C`;
const REG_PHRASE: Record<Regime, string> = { Frozen: 'frozen', Cold: 'cold', Temperate: 'temperate (liquid water possible)', Hot: 'hot', Scorching: 'scorching' };

// each facet maps a friendly choice → a Conditions range. 'any' = no constraint.
type FacetKey = 'starlight' | 'size' | 'atmosphere' | 'star';
interface Facet { key: FacetKey; label: string; field: keyof Conditions; opts: { id: string; label: string; range?: [number, number] }[]; }
const FACETS: Facet[] = [
  { key: 'starlight', label: 'starlight', field: 'flux', opts: [
    { id: 'any', label: 'any starlight' }, { id: 'dim', label: 'dim starlight', range: [400, 800] },
    { id: 'earthish', label: 'Earth-like starlight', range: [800, 1700] }, { id: 'bright', label: 'bright starlight', range: [1700, 3150] } ] },
  { key: 'size', label: 'size', field: 'radius', opts: [
    { id: 'any', label: 'any size' }, { id: 'earth', label: 'Earth-size', range: [0.26, 1.6] }, { id: 'super', label: 'super-Earth', range: [1.6, 2.76] } ] },
  { key: 'atmosphere', label: 'atmosphere', field: 'pressure', opts: [
    { id: 'any', label: 'any atmosphere' }, { id: 'thin', label: 'a thin atmosphere', range: [0.1, 0.5] },
    { id: 'earthish', label: 'an Earth-like atmosphere', range: [0.5, 2] }, { id: 'thick', label: 'a thick atmosphere', range: [3, 12] } ] },
  { key: 'star', label: 'star', field: 'st_teff', opts: [
    { id: 'any', label: 'any star' }, { id: 'red', label: 'a cool red-dwarf star', range: [2500, 4000] }, { id: 'sun', label: 'a Sun-like star', range: [5000, 5777] } ] },
];

function buildConditions(sel: Record<FacetKey, string>): Conditions {
  const c: Conditions = {};
  for (const f of FACETS) { const o = f.opts.find((x) => x.id === sel[f.key]); if (o?.range) c[f.field] = o.range; }
  return c;
}
function sentenceParts(sel: Record<FacetKey, string>): string[] {
  const parts: string[] = [];
  for (const f of FACETS) { const o = f.opts.find((x) => x.id === sel[f.key]); if (o && o.id !== 'any') parts.push(o.label); }
  return parts;
}

const VERDICT_META: Record<Verdict, { label: string; color: string; blurb: string }> = {
  supported: { label: 'Supported', color: '#46d49a', blurb: 'Most matching simulations agree with your claim.' },
  mixed: { label: 'Mixed', color: '#f0b24a', blurb: 'The simulations are split — it goes both ways.' },
  refuted: { label: 'Not supported', color: '#e24b4a', blurb: 'Most matching simulations disagree with your claim.' },
  untestable: { label: 'Too few to tell', color: '#7a8bab', blurb: 'Too few matching simulations to draw a conclusion — loosen a condition.' },
};

function Histogram({ hist, outcome }: { hist: number[]; outcome: Regime }) {
  const W = 460, H = 130, pL = 6, pR = 6, pT = 8, pB = 16;
  const plotW = W - pL - pR, plotH = H - pT - pB;
  const max = Math.max(1, ...hist);
  const bw = plotW / hist.length;
  const binTemp = (i: number) => HIST_MIN + ((i + 0.5) / HIST_BINS) * (HIST_MAX - HIST_MIN);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} role="img" aria-label="distribution of matching worlds by surface temperature">
      <line x1={pL} y1={pT + plotH} x2={W - pR} y2={pT + plotH} stroke="#232b45" strokeWidth="1" />
      {hist.map((v, i) => {
        const h = (v / max) * plotH;
        const inOutcome = regimeOf(binTemp(i)) === outcome;
        return <rect key={i} x={pL + i * bw + bw * 0.08} y={pT + plotH - h} width={bw * 0.84} height={h}
          fill={REG_COLOR[regimeOf(binTemp(i))]} opacity={inOutcome ? 1 : 0.4} rx="0.5" />;
      })}
      {(['150', 'frozen', 'temp.', 'hot', '420'] as const).map((lab, i) => (
        <text key={i} x={pL + ([0, 4, 8, 13, 17][i] + 0.5) * bw} y={H - 4} fill="#828bab" fontSize="9" textAnchor="middle">{lab}</text>
      ))}
    </svg>
  );
}

export default function FindingForge({ sims, nasa, seedName, onClose, onMeet }: {
  sims: TwWorld[]; nasa: World[]; seedName?: string | null; onClose: () => void; onMeet?: (w: World) => void;
}) {
  const [sel, setSel] = useState<Record<FacetKey, string>>({ starlight: 'earthish', size: 'earth', atmosphere: 'any', star: 'any' });
  const [outcome, setOutcome] = useState<Regime>('Temperate');
  const [result, setResult] = useState<TestResult | null>(null);
  const [shared, setShared] = useState(false);

  const conditions = useMemo(() => buildConditions(sel), [sel]);
  const matchCount = useMemo(() => matchSims(conditions, sims).length, [conditions, sims]);
  const parts = sentenceParts(sel);
  const setFacet = (k: FacetKey, v: string) => { setSel((s) => ({ ...s, [k]: v })); setResult(null); };

  const claimText = `Worlds${parts.length ? ' with ' + parts.join(', ') : ''} tend to be ${REG_PHRASE[outcome]}.`;
  const ready = matchCount >= 8;

  const runTest = () => setResult(testClaim(conditions, outcome, sims, nasa));

  const share = () => {
    if (!result) return;
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 660;
    const c = cv.getContext('2d'); if (!c) return;
    const vm = VERDICT_META[result.verdict];
    // background
    c.fillStyle = '#0b1020'; c.fillRect(0, 0, 1200, 660);
    c.fillStyle = '#6fa8ff'; c.font = '600 26px ui-sans-serif, system-ui, sans-serif'; c.fillText('A finding', 60, 78);
    c.fillStyle = '#69728f'; c.font = '20px ui-sans-serif, system-ui, sans-serif'; c.fillText('· ThousandWorlds Explorer', 200, 78);
    // claim (wrapped)
    c.fillStyle = '#e7ebf7'; c.font = '500 38px ui-sans-serif, system-ui, sans-serif';
    let y = 150; const words = claimText.split(' '); let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > 1080 && line) { c.fillText(line, 60, y); y += 50; line = w; } else line = t; }
    c.fillText(line, 60, y); y += 70;
    // verdict badge
    c.fillStyle = vm.color; c.font = '600 30px ui-sans-serif, system-ui, sans-serif'; c.fillText(vm.label.toUpperCase(), 60, y);
    c.fillStyle = '#9aa3be'; c.font = '24px ui-sans-serif, system-ui, sans-serif';
    c.fillText(`${Math.round(result.frac * 100)}% of ${result.n.toLocaleString()} matching simulations`, 60, y + 38);
    c.fillText(`median ${Math.round(result.median)} K (${kToC(result.median)}) · ${result.lo}–${result.hi} K · ${result.realTargets.toLocaleString()} real planets to check`, 60, y + 72);
    // histogram
    const hx = 60, hy = y + 110, hw = 1080, hh = 150, mx = Math.max(1, ...result.hist), bw = hw / result.hist.length;
    result.hist.forEach((v, i) => {
      const bh = (v / mx) * hh; const t = HIST_MIN + ((i + 0.5) / HIST_BINS) * (HIST_MAX - HIST_MIN);
      c.fillStyle = REG_COLOR[regimeOf(t)]; c.globalAlpha = regimeOf(t) === outcome ? 1 : 0.4;
      c.fillRect(hx + i * bw + 2, hy + hh - bh, bw - 4, bh);
    });
    c.globalAlpha = 1;
    c.fillStyle = '#69728f'; c.font = '17px ui-sans-serif, system-ui, sans-serif';
    c.fillText('Tested against the ThousandWorlds climate simulations (Stevenson et al., CC-BY-4.0) — a simulated analogy, not an observation or a habitability claim.', 60, 630);
    cv.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `finding-${outcome.toLowerCase()}.png`; a.click();
      URL.revokeObjectURL(url);
      setShared(true); setTimeout(() => setShared(false), 1800);
    }, 'image/png');
  };

  return (
    <Modal title="Test a hunch — make a finding" onClose={onClose} wide labelledBy="finding-title">
      <div className="ff">
        <p className="ff-lede">Build a claim from the menus, watch how many worlds it covers, then <b>test it against the data</b>. No typing — the gate runs your claim over the real climate simulations and tells you, honestly, whether they back you up.{seedName ? <> Seeded from <b>{seedName}</b>.</> : null}</p>

        <div className="ff-claim">
          <span>Worlds</span>
          {FACETS.map((f, i) => (
            <span key={f.key} className="ff-facet">
              {i === 0 ? 'with' : f.key === 'star' ? 'around' : 'and'}
              <select value={sel[f.key]} onChange={(e) => setFacet(f.key, e.target.value)} aria-label={f.label}>
                {f.opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </span>
          ))}
          <span>tend to be</span>
          <select className="ff-outcome" value={outcome} onChange={(e) => { setOutcome(e.target.value as Regime); setResult(null); }} aria-label="climate outcome" style={{ color: REG_COLOR[outcome] }}>
            {REGIMES.map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}
          </select>
        </div>

        <div className="ff-strength">
          <span className="ff-count"><b style={{ color: ready ? 'var(--accent)' : '#f0b24a' }}>{matchCount.toLocaleString()}</b> simulated worlds match your claim</span>
          {!ready && <span className="ff-hint">— too few to test; loosen a condition</span>}
          {ready && !result && <button className="cta ff-test" onClick={runTest}>Test it against the data →</button>}
        </div>

        {result && (
          <div className="ff-result">
            <div className="ff-verdict" style={{ borderColor: VERDICT_META[result.verdict].color }}>
              <span className="ff-vbadge" style={{ color: VERDICT_META[result.verdict].color }}>{VERDICT_META[result.verdict].label}</span>
              <span className="ff-vblurb">{VERDICT_META[result.verdict].blurb}</span>
            </div>
            <p className="ff-say">
              Of the <b>{result.n.toLocaleString()}</b> matching simulations, <b style={{ color: REG_COLOR[outcome] }}>{Math.round(result.frac * 100)}%</b> are {REG_PHRASE[outcome]} — median <b>{Math.round(result.median)} K ({kToC(result.median)})</b>, spanning {Math.round(result.lo)}–{Math.round(result.hi)} K.
            </p>
            <Histogram hist={result.hist} outcome={outcome} />
            <p className="ff-targets">
              {result.realTargets.length > 0
                ? <><b>{result.realTargets.length.toLocaleString()}</b> real discovered planets match these conditions — concrete targets a telescope could check{result.realTargets.length <= 8 && onMeet ? ': ' : '.'}{result.realTargets.length <= 8 && onMeet && result.realTargets.map((w, i) => <span key={w.name}>{i > 0 ? ', ' : ''}<button className="linkbtn" onClick={() => onMeet(w)}>{w.name}</button></span>)}</>
                : 'No real discovered planets match these exact conditions yet — a prediction awaiting its first target.'}
            </p>
            <div className="ff-actions">
              <button className="cta ff-share" onClick={share}>{shared ? 'Image saved ✓' : '⤓ Share this finding (image)'}</button>
              <button className="linkbtn" onClick={() => setResult(null)}>← tweak the claim</button>
            </div>
            <SaveShareBar
              type="finding"
              title={claimText}
              buildPayload={() => ({
                claim: claimText, sel, outcome,
                result: { verdict: result.verdict, n: result.n, frac: result.frac, median: result.median, lo: result.lo, hi: result.hi, realTargets: result.realTargets.length },
              })}
            />
          </div>
        )}

        <p className="ff-honest">Tested against the ThousandWorlds climate <b>simulations</b> (Stevenson, Cranmer et al., <a href="https://arxiv.org/abs/2606.18338" target="_blank" rel="noreferrer">CC-BY-4.0</a>) — global-mean model output, a simulated analogy, never an observation or a habitability claim.</p>
      </div>
    </Modal>
  );
}
