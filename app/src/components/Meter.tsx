// Segmented LED ladder, one row per channel, drawn on a canvas at display rate.
import { useEffect, useRef } from 'react';
import { FLOOR_DB, nextPeakHold, peakOf, smoothLevel, toDb, zoneOf, type PeakHold, type Zone } from '../lib/meter';

const SEGMENTS = 48;
const SCALE = [-48, -36, -24, -18, -12, -6, -3, 0];
const xOf = (db: number) => (db - FLOOR_DB) / -FLOOR_DB;

type Props = {
  channels: number;
  analysers: AnalyserNode[];
  /** Loudest displayed level across channels, every frame (for the cable glow). */
  onLevel?: (maxDb: number) => void;
};

function geometry(channels: number) {
  if (channels <= 2) return { row: 12, gap: 6 };
  if (channels <= 8) return { row: 9, gap: 3 };
  return { row: 7, gap: 2 };
}

const channelLabel = (c: number, channels: number) => {
  if (channels === 2) return c === 0 ? 'L' : 'R';
  return c === 0 || (c + 1) % 4 === 0 ? String(c + 1) : '';
};

export function Meter({ channels, analysers, onLevel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLevelRef = useRef(onLevel);
  onLevelRef.current = onLevel;
  const { row, gap } = geometry(channels);
  const height = channels * row + (channels - 1) * gap;

  useEffect(() => {
    const canvas = canvasRef.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return;
    const css = getComputedStyle(canvas);
    const color: Record<Zone, string> = {
      safe: css.getPropertyValue('--led-safe').trim(),
      hot: css.getPropertyValue('--led-hot').trim(),
      clip: css.getPropertyValue('--led-clip').trim(),
    };
    const levels = new Array<number>(channels).fill(FLOOR_DB);
    const holds: PeakHold[] = Array.from({ length: channels }, () => ({ db: FLOOR_DB, heldMs: 0 }));
    const samples = new Float32Array(1024);
    let dpr = 1;
    let last = performance.now();
    let raf = 0;

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = () => {
      const W = canvas.width;
      const segW = W / SEGMENTS;
      const segGap = Math.max(1, Math.round(1.5 * dpr));
      g.clearRect(0, 0, W, canvas.height);
      for (let c = 0; c < channels; c++) {
        const y = Math.round(c * (row + gap) * dpr);
        const h = Math.round(row * dpr);
        const holdSeg = holds[c].db > FLOOR_DB ? Math.min(SEGMENTS - 1, Math.floor(xOf(holds[c].db) * SEGMENTS - 1e-6)) : -1;
        for (let s = 0; s < SEGMENTS; s++) {
          const low = FLOOR_DB + (s / SEGMENTS) * -FLOOR_DB;
          const lit = levels[c] > low || s === holdSeg;
          g.globalAlpha = lit ? 1 : 0.09;
          g.fillStyle = color[zoneOf(low)];
          g.fillRect(Math.round(s * segW), y, Math.max(1, Math.round(segW) - segGap), h);
        }
      }
      g.globalAlpha = 1;
    };

    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      let max = FLOOR_DB;
      for (let c = 0; c < channels; c++) {
        const analyser = analysers[c];
        let measured = FLOOR_DB;
        if (analyser) {
          analyser.getFloatTimeDomainData(samples);
          measured = toDb(peakOf(samples));
        }
        levels[c] = Math.min(0, Math.max(FLOOR_DB, smoothLevel(levels[c], measured, dt)));
        holds[c] = nextPeakHold(holds[c], levels[c], dt);
        if (levels[c] > max) max = levels[c];
      }
      draw();
      onLevelRef.current?.(max);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [channels, analysers, row, gap]);

  return (
    <div className="meter">
      <div className="meter-labels" style={{ gridTemplateRows: `repeat(${channels}, ${row}px)`, rowGap: gap }}>
        {Array.from({ length: channels }, (_, c) => (
          <span key={c}>{channelLabel(c, channels)}</span>
        ))}
      </div>
      <div className="meter-well">
        <canvas ref={canvasRef} style={{ height }} aria-label={`${channels}-channel level meter`} role="img" />
        <div className="meter-scale" aria-hidden>
          {SCALE.map((db) => (
            <span key={db} style={{ left: `${xOf(db) * 100}%` }}>
              {db === 0 ? '0' : db}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
