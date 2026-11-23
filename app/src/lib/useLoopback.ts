// Opens the Audio Router *input* (what apps played into it) for metering.
import { useEffect, useState } from 'react';
import { bridge } from './bridge';

export type LoopbackStatus = 'off' | 'starting' | 'live' | 'denied' | 'missing' | 'error';

const NO_SINK = { type: 'none' };

// Chrome labels Core Audio devices by name, sometimes with a suffix like
// " (Virtual)", so match by prefix.
const matches = (label: string, name: string) => label === name || label.startsWith(`${name} (`);

async function findInput(name: string): Promise<MediaDeviceInfo | undefined> {
  const find = async () =>
    (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'audioinput' && matches(d.label, name));
  let found = await find();
  if (!found) {
    // Labels stay empty until the page has opened a capture stream once.
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    found = await find();
  }
  return found;
}

// Demo mode: N detuned oscillators with slow tremolo, so meters move.
function demoSource(ctx: AudioContext, channels: number): AudioNode {
  const merger = ctx.createChannelMerger(channels);
  for (let c = 0; c < channels; c++) {
    const osc = ctx.createOscillator();
    osc.frequency.value = 110 * (1 + (c % 4)) + c * 3;
    const amp = ctx.createGain();
    amp.gain.value = 0.24;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.21 + c * 0.13;
    const depth = ctx.createGain();
    depth.gain.value = 0.22;
    lfo.connect(depth).connect(amp.gain);
    osc.connect(amp).connect(merger, 0, c);
    osc.start();
    lfo.start();
  }
  return merger;
}

export function useLoopback(deviceName: string, channels: number, enabled: boolean, demo: boolean) {
  const [status, setStatus] = useState<LoopbackStatus>('off');
  const [message, setMessage] = useState<string | null>(null);
  const [analysers, setAnalysers] = useState<AnalyserNode[]>([]);

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      setAnalysers([]);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    // sinkId 'none': the meter renders without opening any output device.
    const ctx = new AudioContext({ latencyHint: 'interactive', sinkId: NO_SINK } as AudioContextOptions);

    const start = async () => {
      setStatus('starting');
      setMessage(null);
      let source: AudioNode;
      let count = channels;
      if (demo) {
        source = demoSource(ctx, channels);
      } else {
        if (!(await bridge().requestMic())) {
          setStatus('denied');
          return;
        }
        const input = await findInput(deviceName);
        if (cancelled) return;
        if (!input) {
          setStatus('missing');
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: input.deviceId },
            channelCount: { ideal: channels },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        if (cancelled) return;
        count = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 2;
        source = ctx.createMediaStreamSource(stream);
      }

      const splitter = ctx.createChannelSplitter(count);
      source.connect(splitter);
      const nodes = Array.from({ length: count }, (_, c) => {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        splitter.connect(a, c);
        return a;
      });

      if (ctx.state === 'suspended') await ctx.resume();
      if (cancelled) return;
      setAnalysers(nodes);
      setStatus('live');
      if (!demo && count < channels) setMessage(`Chromium opened ${count} of ${channels} channels; metering the first ${count}.`);
    };

    start().catch((err: unknown) => {
      if (cancelled) return;
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx.close();
      setAnalysers([]);
    };
  }, [deviceName, channels, enabled, demo]);

  return { status, message, analysers };
}
