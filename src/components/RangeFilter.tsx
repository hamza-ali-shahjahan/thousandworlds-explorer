export type Bound = [number | null, number | null];

interface Props {
  label: string;
  unit: string;
  domain: [number, number];
  scale: 'log' | 'linear';
  value: Bound;
  onChange: (v: Bound) => void;
  fmt: (n: number) => string;
}

const STEPS = 1000;
const round3 = (v: number) => Number(v.toPrecision(3));

export default function RangeFilter({ label, unit, domain, scale, value, onChange, fmt }: Props) {
  const posToVal = (pos: number) => {
    const t = pos / STEPS;
    if (scale === 'log') {
      const lo = Math.log10(domain[0]), hi = Math.log10(domain[1]);
      return Math.pow(10, lo + t * (hi - lo));
    }
    return domain[0] + t * (domain[1] - domain[0]);
  };
  const valToPos = (val: number) => {
    if (scale === 'log') {
      const lo = Math.log10(domain[0]), hi = Math.log10(domain[1]);
      return Math.round(((Math.log10(val) - lo) / (hi - lo)) * STEPS);
    }
    return Math.round(((val - domain[0]) / (domain[1] - domain[0])) * STEPS);
  };

  const loPos = value[0] == null ? 0 : Math.max(0, Math.min(STEPS, valToPos(value[0])));
  const hiPos = value[1] == null ? STEPS : Math.max(0, Math.min(STEPS, valToPos(value[1])));

  const emit = (lp: number, hp: number) => {
    onChange([lp <= 0 ? null : round3(posToVal(lp)), hp >= STEPS ? null : round3(posToVal(hp))]);
  };

  const loVal = value[0] ?? domain[0];
  const hiVal = value[1] ?? domain[1];
  const active = value[0] != null || value[1] != null;

  return (
    <div className="rangef">
      <div className="lab">
        <span>{label}</span>
        <b style={active ? undefined : { color: 'var(--text-faint)', fontWeight: 400 }}>
          {active ? `${fmt(loVal)} – ${fmt(hiVal)}${unit ? ' ' + unit : ''}` : 'any'}
        </b>
      </div>
      <div className="range">
        <div className="track" />
        <div className="fill" style={{ left: `${(loPos / STEPS) * 100}%`, width: `${((hiPos - loPos) / STEPS) * 100}%` }} />
        <input type="range" min={0} max={STEPS} value={loPos} aria-label={`${label} minimum`}
          onChange={(e) => emit(Math.min(Number(e.target.value), hiPos), hiPos)} />
        <input type="range" min={0} max={STEPS} value={hiPos} aria-label={`${label} maximum`}
          onChange={(e) => emit(loPos, Math.max(Number(e.target.value), loPos))} />
      </div>
    </div>
  );
}
