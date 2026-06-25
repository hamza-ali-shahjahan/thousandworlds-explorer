import { useEffect, type ReactNode } from 'react';

// A centered, dimmed-backdrop modal. The reusable shell behind "How this works",
// the model-comparison table, and the first-run wizard. Closes on backdrop click,
// the X button, or Escape.
export default function Modal({ title, onClose, children, wide, labelledBy }: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  labelledBy?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${wide ? ' wide' : ''}`}
        role="dialog" aria-modal="true" aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          {title && <h2 className="modal-title" id={labelledBy}>{title}</h2>}
          <button className="modal-x" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
