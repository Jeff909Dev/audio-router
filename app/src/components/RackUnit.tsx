// One driver variant, drawn as a 1U-style rack panel.
import { useCallback, useRef, useState } from 'react';
import { bridge, type DefaultKind, type Device, type Result, type Variant } from '../lib/bridge';
import { linkOf, listenCandidates, multiUidOf } from '../lib/link';
import { FLOOR_DB } from '../lib/meter';
import { useLoopback } from '../lib/useLoopback';
import { Led, PanelButton, Picker, RateSelector, type LedState } from './Controls';
import { Meter } from './Meter';
import { PatchCable } from './PatchCable';

const RATES = [44100, 48000, 88200, 96000, 176400, 192000];

type Props = {
  variant: Variant;
  devices: Device[];
  fallbackOutput: Device | undefined;
  demo: boolean;
  onChanged: () => void;
};

function statusOf(variant: Variant, device: Device | undefined): [LedState, string] {
  if (!variant.installed) return ['off', 'Not installed'];
  if (!device) return ['fault', 'Installed · not loaded'];
  return ['ok', `Online · ${device.sampleRate / 1000} kHz`];
}

// Runs bridge calls one after another and stops at the first failure.
async function inOrder(steps: (() => Promise<Result>)[]): Promise<Result> {
  for (const step of steps) {
    const r = await step();
    if (!r.ok) return r;
  }
  return { ok: true };
}

export function RackUnit({ variant, devices, fallbackOutput, demo, onChanged }: Props) {
  const device = devices.find((d) => d.uid === variant.uid);
  const link = linkOf(devices, variant.uid);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loop = useLoopback(variant.name, variant.channels, !!device, demo);
  const cableRef = useRef<SVGSVGElement>(null);

  const onLevel = useCallback((db: number) => {
    const signal = Math.min(1, Math.max(0, (db - (FLOOR_DB + 12)) / 42));
    cableRef.current?.style.setProperty('--signal', signal.toFixed(3));
  }, []);

  const act = async (label: string, fn: () => Promise<Result>) => {
    setBusy(label);
    setNotice(null);
    try {
      const r = await fn();
      if (!r.ok && !r.cancelled) setNotice(r.message ?? 'Something went wrong.');
    } finally {
      setBusy(null);
      onChanged();
    }
  };

  const setDefault = (kind: DefaultKind, uid: string) => act(kind, () => bridge().setDefault(kind, uid));

  // With a link, the Mac's sound goes through it, so you hear what you record.
  const soundOut = device && (link?.multi ?? device);

  const listenOptions = listenCandidates(devices).map((d) => ({ value: d.uid, label: d.name }));
  if (link && !link.listen) {
    const suffix = ` + ${variant.name}`;
    const name = link.multi.name.endsWith(suffix) ? link.multi.name.slice(0, -suffix.length) : link.multi.name;
    listenOptions.push({ value: link.listenUid, label: `${name} · not connected` });
  }

  const listenOn = (listenUid: string | null) => {
    if (listenUid === (link?.listenUid ?? null)) return;
    // If the Mac's sound was going into the router, keep it going there through the new link.
    const routed = !!device?.isDefaultOutput || !!link?.multi.isDefaultOutput;
    const steps: (() => Promise<Result>)[] = [];
    if (link) {
      const back = link.listen ?? fallbackOutput;
      if (!listenUid && link.multi.isDefaultOutput && back) steps.push(() => bridge().setDefault('output', back.uid));
      steps.push(() => bridge().removeMultiOutput(link.multi.uid));
    }
    if (listenUid) {
      steps.push(() => bridge().multiOutput(listenUid, variant.uid));
      if (routed) steps.push(() => bridge().setDefault('output', multiUidOf(listenUid, variant.uid)));
    }
    void act('listen', () => inOrder(steps));
  };

  const [led, ledText] = statusOf(variant, device);
  const model = `AR·${variant.channels}`;

  return (
    <section className="unit" data-installed={variant.installed} aria-label={variant.name}>
      <div className="ear" aria-hidden>
        <i />
        <i />
      </div>
      <div className="faceplate">
        <header className="unit-head">
          <span className="model">{model}</span>
          <div className="unit-title">
            <h2>{variant.name}</h2>
            <span>
              {variant.channels} in · {variant.channels} out · loopback
            </span>
          </div>
          <Led state={led}>{ledText}</Led>
          <div className="grow" />
          {variant.installed ? (
            <PanelButton tone="danger" busy={busy === 'uninstall'} onClick={() => act('uninstall', () => bridge().uninstall(variant.id))}>
              {busy === 'uninstall' ? 'Removing…' : 'Uninstall'}
            </PanelButton>
          ) : (
            <PanelButton
              tone="primary"
              busy={busy === 'install'}
              disabled={!variant.built}
              onClick={() => act('install', () => bridge().install(variant.id))}
            >
              {busy === 'install' ? 'Installing…' : 'Install'}
            </PanelButton>
          )}
        </header>

        {variant.installed ? (
          <>
            <div className="unit-body">
              <PatchCable
                ref={cableRef}
                live={loop.status === 'live'}
                outIsDefault={!!device?.isDefaultOutput || !!link?.multi.isDefaultOutput}
                inIsDefault={!!device?.isDefaultInput}
              />
              <div className="unit-meters">
                <Meter channels={variant.channels} analysers={loop.analysers} onLevel={onLevel} />
                <p className="meter-caption">
                  {loop.status === 'live' && 'Level arriving at IN — what any app recording from this device will get.'}
                  {loop.status === 'starting' && 'Opening the input…'}
                  {loop.status === 'denied' && 'Microphone access is off for this app, so the meter can’t listen. Enable it in System Settings › Privacy › Microphone.'}
                  {loop.status === 'missing' && 'Core Audio lists the device, but Chromium can’t see its input yet.'}
                  {loop.status === 'error' && `Meter unavailable: ${loop.message}`}
                  {loop.status === 'off' && !device && 'Waiting for Core Audio to publish the device. If this persists, reinstall.'}
                </p>
              </div>
            </div>

            <footer className="unit-controls">
              <div className="field">
                <span className="legend">Rate</span>
                <RateSelector
                  rates={device?.sampleRates.length ? device.sampleRates : RATES}
                  value={device?.sampleRate ?? null}
                  disabled={!device || !!busy}
                  onChange={(rate) => device && act('rate', () => bridge().setRate(device.uid, rate))}
                />
              </div>
              <div className="field">
                <span className="legend">Route</span>
                <div className="btn-row">
                  <PanelButton disabled={!soundOut || soundOut.isDefaultOutput} busy={busy === 'output'} onClick={() => soundOut && setDefault('output', soundOut.uid)}>
                    {soundOut?.isDefaultOutput ? 'Is sound output' : 'Use as sound output'}
                  </PanelButton>
                  <PanelButton disabled={!device || device.isDefaultInput} busy={busy === 'input'} onClick={() => device && setDefault('input', device.uid)}>
                    {device?.isDefaultInput ? 'Is sound input' : 'Use as sound input'}
                  </PanelButton>
                </div>
              </div>
              <div className="field">
                <span className="legend">Listen on</span>
                <Picker
                  value={link?.listenUid ?? null}
                  placeholder="Off"
                  disabled={!device || !!busy}
                  options={listenOptions}
                  onChange={listenOn}
                />
              </div>
            </footer>

            {link && (
              <p className="usage">
                In Ableton, Settings › Audio › Output Device → <b>{link.multi.name}</b>; in the recorder, pick{' '}
                <b>{variant.name}</b> as the microphone.
              </p>
            )}

            {device?.isDefaultOutput && (
              <div className="advice">
                <span>
                  Your Mac’s sound is going into {variant.name} only, so you can’t hear it.{' '}
                  {link ? `Use as sound output sends it through ${link.multi.name}.` : 'Pick a device under Listen on to hear it too.'}
                </span>
                {fallbackOutput && (
                  <PanelButton busy={busy === 'output'} onClick={() => setDefault('output', fallbackOutput.uid)}>
                    Back to {fallbackOutput.name}
                  </PanelButton>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="unit-empty">
            <p>
              Adds a virtual device with {variant.channels} inputs and {variant.channels} outputs. Whatever an app plays into
              it comes straight back out as an input — no latency, no resampling.
            </p>
            <p className="dim">
              {variant.built
                ? 'Installing asks for your admin password and restarts Core Audio, so sound drops for a second.'
                : 'Not built yet — run make in the project folder first.'}
            </p>
          </div>
        )}

        {notice && <p className="notice">{notice}</p>}
        {!notice && loop.status === 'live' && loop.message && <p className="notice">{loop.message}</p>}
      </div>
      <div className="ear" aria-hidden>
        <i />
        <i />
      </div>
    </section>
  );
}
