// Every Core Audio device, with the system's sound output/input selectable
// from here — the quickest way back to your speakers after routing.
import { useState } from 'react';
import { bridge, type DefaultKind, type Device } from '../lib/bridge';

const isRouter = (d: Device) => d.uid.startsWith('AudioRouter');

export function Patchbay({ devices, onChanged }: { devices: Device[]; onChanged: () => void }) {
  const [pending, setPending] = useState<string | null>(null);
  const visible = devices.filter((d) => d.inputChannels > 0 || d.outputChannels > 0);

  const choose = async (kind: DefaultKind, d: Device) => {
    setPending(`${kind}:${d.uid}`);
    try {
      await bridge().setDefault(kind, d.uid);
    } finally {
      setPending(null);
      onChanged();
    }
  };

  const chip = (kind: DefaultKind, d: Device, label: string, enabled: boolean, active: boolean) => (
    <button
      type="button"
      className="chip"
      aria-pressed={active}
      disabled={!enabled || active || pending !== null}
      title={enabled ? `Use ${d.name} as the sound ${kind}` : `${d.name} has no ${kind}s`}
      onClick={() => choose(kind, d)}
    >
      {label}
    </button>
  );

  return (
    <section className="patchbay" aria-label="Audio devices">
      <header>
        <h2>Patch bay</h2>
        <span>Where your Mac sends and takes sound</span>
      </header>
      <ul>
        {visible.map((d) => (
          <li key={d.uid} data-router={isRouter(d) || undefined}>
            <div className="chips">
              {chip('output', d, 'OUT', d.outputChannels > 0, d.isDefaultOutput)}
              {chip('input', d, 'IN', d.inputChannels > 0, d.isDefaultInput)}
            </div>
            <span className="dev-name">{d.name}</span>
            <span className="dev-meta">{d.transport}</span>
            <span className="dev-meta num">
              {d.inputChannels} in / {d.outputChannels} out
            </span>
            <span className="dev-meta num">{d.sampleRate ? `${d.sampleRate / 1000} kHz` : '—'}</span>
          </li>
        ))}
        {visible.length === 0 && <li className="dev-empty">No audio devices reported by Core Audio.</li>}
      </ul>
    </section>
  );
}
