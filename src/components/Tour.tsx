import { TOUR } from '../lib/tour';

interface Props {
  index: number;
  title: string;
  text: string;
  worldName: string;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  total?: number;
}

export default function Tour({ index, title, text, worldName, onPrev, onNext, onExit, total: totalProp }: Props) {
  const total = totalProp ?? TOUR.length;
  const last = index === total - 1;
  return (
    <div className="tourbar">
      <div className="tourmain">
        <div className="tourtop">
          <span className="tourtag">Guided tour · stop {index + 1} of {total}</span>
          <span className="tourworld">{worldName}</span>
        </div>
        <div className="tourtitle">{title}</div>
        <p className="tourtext">{text}</p>
      </div>
      <div className="tourctrl">
        <button className="btn" onClick={onPrev} disabled={index === 0}>Back</button>
        <button className="btn primary" onClick={onNext}>{last ? 'Finish' : 'Next world'}</button>
        <button className="btn ghost" onClick={onExit} aria-label="Exit tour">Exit</button>
      </div>
    </div>
  );
}
