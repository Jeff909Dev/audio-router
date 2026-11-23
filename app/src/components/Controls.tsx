// Small panel controls: sample-rate selector, dropdown picker, push button, LED.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function PanelButton({
  children,
  onClick,
  disabled,
  tone = 'plain',
  busy,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'plain' | 'primary' | 'danger';
  busy?: boolean;
}) {
  return (
    <button type="button" className="btn" data-tone={tone} data-busy={busy || undefined} disabled={disabled || busy} onClick={onClick}>
      {children}
    </button>
  );
}

export type LedState = 'off' | 'ok' | 'warn' | 'fault';

export function Led({ state, children }: { state: LedState; children: ReactNode }) {
  return (
    <span className="led" data-state={state}>
      <i aria-hidden />
      {children}
    </span>
  );
}

const kHz = (rate: number) => String(rate / 1000).replace(/\.0$/, '');

export function RateSelector({
  rates,
  value,
  disabled,
  onChange,
}: {
  rates: number[];
  value: number | null;
  disabled?: boolean;
  onChange: (rate: number) => void;
}) {
  return (
    <div className="rates" role="radiogroup" aria-label="Sample rate">
      {rates.map((r) => (
        <button
          key={r}
          type="button"
          role="radio"
          aria-checked={r === value}
          className="rate"
          disabled={disabled}
          onClick={() => r !== value && onChange(r)}
        >
          {kHz(r)}
        </button>
      ))}
      <span className="rates-unit">kHz</span>
    </div>
  );
}

export type PickerOption = { value: string; label: string };

export function Picker({
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  value: string | null;
  options: PickerOption[];
  placeholder: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const choose = (v: string | null) => {
    setOpen(false);
    onChange(v);
  };

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className="picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        data-active={!!current || undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{current ? current.label : placeholder}</span>
        <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden>
          <path d="M1 1l3.5 3.5L8 1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {open && (
        <ul className="picker-list" role="listbox" id={listId}>
          <li role="option" aria-selected={value === null} onClick={() => choose(null)}>
            Off
          </li>
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value} onClick={() => choose(o.value)}>
              {o.label}
            </li>
          ))}
          {options.length === 0 && <li className="picker-empty">No other outputs found</li>}
        </ul>
      )}
    </div>
  );
}
