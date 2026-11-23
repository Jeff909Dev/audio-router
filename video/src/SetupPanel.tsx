// Setup beat: four steps on the left, and on the right what each one looks like in the app.
import type { CSSProperties, ReactNode } from 'react';
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { Arrow, Meter } from './parts';
import { music } from './scene';
import { FPS, lerp, ramp, T, visible } from './timeline';
import { C, MONO, SANS } from './theme';

type Part = { text: string } | { placeholder: string } | { name: string } | 'arrow';
type Shot = { cx: number; cy: number; z: number; ring: { x: number; y: number; w: number; h: number } };

// Shot coordinates are pixels of public/app-listening.png (1960x1520, demo devices).
const STEPS: { parts: Part[]; detail: string; shot?: Shot }[] = [
  {
    parts: [{ text: 'Install the driver' }],
    detail: 'Click Install, then enter your admin password.',
  },
  {
    parts: [{ text: 'Listen on' }, 'arrow', { placeholder: 'your headphones' }],
    detail: 'The app builds the split device for you.',
    shot: { cx: 1597, cy: 712, z: 1.5, ring: { x: 1378, y: 676, w: 440, h: 80 } },
  },
  {
    parts: [{ text: 'DAW output' }, 'arrow', { placeholder: 'your headphones' }, { name: '+ Audio Router 2ch' }],
    detail: 'In Ableton Live: Settings › Audio › Output Device.',
    shot: { cx: 753, cy: 729, z: 1.6, ring: { x: 563, y: 776, w: 381, h: 40 } },
  },
  {
    parts: [{ text: 'Recorder mic' }, 'arrow', { name: 'Audio Router 2ch' }],
    detail: 'In your screen recorder, pick it as the microphone.',
    shot: { cx: 1290, cy: 729, z: 1.6, ring: { x: 1128, y: 776, w: 194, h: 40 } },
  },
];

const CARD_W = 850;
const CARD_H = 440;
const COL_X = 960;

const stepEnd = (i: number) => T.steps[i + 1] ?? T.stepsEnd;

function activeStep(t: number): number {
  let active = -1;
  T.steps.forEach((start, i) => {
    if (t >= start) active = i;
  });
  return active;
}

function StepRow({ index, state, glow, parts }: { index: number; state: 'upcoming' | 'active' | 'done'; glow: number; parts: Part[] }) {
  const color = state === 'active' ? C.legend : state === 'done' ? C.legend2 : C.legend3;
  const chip: CSSProperties =
    state === 'active'
      ? { background: C.amber, color: C.rack, borderColor: C.amber }
      : state === 'done'
        ? { background: C.well, color: C.amber, borderColor: C.amberEdge }
        : { background: C.well, color: C.legend3, borderColor: C.seam };
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 20, height: 70, padding: '0 18px', color }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 6,
          background: C.amberWash,
          boxShadow: `inset 0 0 0 1.5px ${C.amberEdge}`,
          opacity: glow,
        }}
      />
      <div
        style={{
          position: 'relative',
          width: 42,
          height: 42,
          borderRadius: 4,
          border: '1.5px solid',
          display: 'grid',
          placeItems: 'center',
          fontFamily: MONO,
          fontSize: 22,
          fontWeight: 500,
          ...chip,
        }}
      >
        {index + 1}
      </div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, fontSize: 30, fontWeight: 500, whiteSpace: 'nowrap' }}>
        {parts.map((p, i) => {
          if (p === 'arrow') return <Arrow key={i} size={26} color={state === 'active' ? C.amber : C.legend3} />;
          if ('placeholder' in p)
            return (
              <span key={i} style={{ fontSize: 26, padding: '2px 12px', border: `1.5px dashed ${C.legend4}`, borderRadius: 4, color: state === 'upcoming' ? C.legend3 : C.legend2 }}>
                {p.placeholder}
              </span>
            );
          if ('name' in p)
            return (
              <span key={i} style={{ fontWeight: 600 }}>
                {p.name}
              </span>
            );
          return <span key={i}>{p.text}</span>;
        })}
      </div>
    </div>
  );
}

// The app's unit header, redrawn: Install, then the LED comes online and the cable lights up.
function InstallUnit({ frame }: { frame: number }) {
  const t = frame / FPS;
  const t0 = T.steps[0];
  const press = ramp(frame, t0 + 0.8, 0.1) * (1 - ramp(frame, t0 + 0.92, 0.15));
  const installing = t >= t0 + 0.9 && t < t0 + 1.6;
  const installed = t >= t0 + 1.6;
  const body = ramp(frame, t0 + 1.6, 0.4);
  const level = installed ? music(frame, 9) * ramp(frame, t0 + 1.7, 0.4) : 0;
  const signal = Math.min(1, Math.max(0, (level - 0.1) / 0.5));

  const button: CSSProperties = installed
    ? { color: C.legend2, borderColor: C.seamStrong, background: C.raised }
    : { color: C.amber, borderColor: C.amberEdge, background: `rgba(240, 164, 60, ${0.08 + press * 0.16})`, opacity: installing ? 0.75 : 1 };

  return (
    <div style={{ width: 810, display: 'grid', gridTemplateColumns: '30px 1fr 30px', background: C.faceplate, border: `1.5px solid ${C.seam}`, borderRadius: 8, fontFamily: SANS }}>
      <Ear side="left" />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '20px 22px', borderBottom: `1.5px solid ${C.seamSoft}` }}>
          <span style={{ fontFamily: MONO, fontSize: 20, fontWeight: 500, color: C.legend2, padding: '4px 10px', border: `1.5px solid ${C.seamStrong}`, borderRadius: 4 }}>AR·2</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 27, fontWeight: 600, color: installed ? C.legend : C.legend2 }}>Audio Router 2ch</span>
            <span style={{ fontSize: 17, color: C.legend3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>2 in · 2 out · loopback</span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 18, letterSpacing: '0.1em', textTransform: 'uppercase', color: installed ? C.legend2 : C.legend3 }}>
            <i
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: installed ? C.ledSafe : 'rgba(255, 255, 255, 0.1)',
                boxShadow: installed ? '0 0 8px rgba(87, 211, 132, 0.6)' : 'none',
              }}
            />
            {installed ? 'Online · 48 kHz' : 'Not installed'}
          </span>
          <div style={{ flex: 1 }} />
          <span
            style={{
              fontSize: 19,
              fontWeight: 500,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '10px 16px',
              border: '1.5px solid',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              transform: `scale(${1 - press * 0.05})`,
              ...button,
            }}
          >
            {installed ? 'Uninstall' : installing ? 'Installing…' : 'Install'}
          </span>
        </div>
        <div style={{ position: 'relative', height: 210 }}>
          <div style={{ position: 'absolute', inset: 0, padding: '22px 26px', opacity: 1 - body }}>
            <p style={{ margin: 0, fontSize: 23, lineHeight: 1.4, color: C.legend2 }}>
              Adds a virtual device with 2 inputs and 2 outputs. Whatever an app plays into it comes straight back out as an input.
            </p>
            <p style={{ margin: '12px 0 0', fontSize: 21, lineHeight: 1.4, color: C.legend3 }}>
              Installing asks for your admin password and restarts Core Audio, so sound drops for a second.
            </p>
          </div>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 26, padding: '0 22px', opacity: body }}>
            <AppCable signal={signal} />
            <svg width={390} height={60} viewBox="0 0 390 60">
              <text x={0} y={20} fill={C.legend3} style={{ fontFamily: MONO, fontSize: 14 }}>
                L
              </text>
              <text x={0} y={48} fill={C.legend3} style={{ fontFamily: MONO, fontSize: 14 }}>
                R
              </text>
              <Meter x={22} y={8} w={368} h={14} level={level} segments={30} />
              <Meter x={22} y={36} w={368} h={14} level={level * 0.96} segments={30} />
            </svg>
          </div>
        </div>
      </div>
      <Ear side="right" />
    </div>
  );
}

function Ear({ side }: { side: 'left' | 'right' }) {
  const screw: CSSProperties = { width: 11, height: 11, borderRadius: '50%', background: C.well, boxShadow: `inset 0 0 0 1.5px ${C.seamStrong}` };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '18px 0',
        [side === 'left' ? 'borderRight' : 'borderLeft']: `1.5px solid ${C.seamSoft}`,
      }}
    >
      <i style={screw} />
      <i style={screw} />
    </div>
  );
}

// PatchCable.tsx from the app, same geometry, drawn at 1.2x.
function AppCable({ signal }: { signal: number }) {
  const JY = 54;
  const d = `M 46 ${JY + 18} C 46 150, 194 150, 194 ${JY + 18}`;
  const jack = (x: number, label: string, hint: string) => (
    <g transform={`translate(${x} 0)`}>
      <text x={0} y={12} textAnchor="middle" fill={C.legend2} style={{ fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: '0.18em' }}>
        {label}
      </text>
      <text x={0} y={27} textAnchor="middle" fill={C.legend3} style={{ fontFamily: SANS, fontSize: 10.5 }}>
        {hint}
      </text>
      <circle cx={0} cy={JY} r={13} fill={C.raised} stroke={C.seamStrong} />
      <circle cx={0} cy={JY} r={9} fill={C.jackNut} stroke="rgba(0, 0, 0, 0.6)" />
      <circle cx={0} cy={JY} r={4.5} fill={C.jackHole} />
      <rect x={-5} y={JY + 6} width={10} height={14} rx={2} fill={C.plug} stroke={C.seamStrong} />
    </g>
  );
  const core = `color-mix(in oklab, ${C.amber} ${(signal * 100).toFixed(1)}%, ${C.cableOff})`;
  return (
    <svg width={288} height={168} viewBox="0 0 240 140" style={{ overflow: 'visible', flexShrink: 0 }}>
      <path d={d} fill="none" stroke="rgba(0, 0, 0, 0.55)" strokeWidth={9} strokeLinecap="round" transform="translate(0 3)" />
      <path d={d} fill="none" stroke={core} strokeWidth={6} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 ${(signal * 7).toFixed(2)}px rgba(240, 164, 60, 0.55))` }} />
      <path d={d} fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth={1.4} strokeLinecap="round" transform="translate(0 -1.6)" />
      {jack(46, 'OUT', 'apps play here')}
      {jack(194, 'IN', 'apps record here')}
    </svg>
  );
}

// The real app screenshot, panned and zoomed to the control each step is about.
function ScreenshotCamera({ frame }: { frame: number }) {
  const shots = STEPS.map((s) => s.shot);
  const s1 = shots[1]!;
  const s2 = shots[2]!;
  const s3 = shots[3]!;
  const settle = ramp(frame, T.steps[1], 1.4, 'out');
  let cam = { cx: s1.cx, cy: s1.cy, z: lerp(1.25, s1.z, settle) };
  const p2 = ramp(frame, T.steps[2], 0.9);
  cam = { cx: lerp(cam.cx, s2.cx, p2), cy: lerp(cam.cy, s2.cy, p2), z: lerp(cam.z, s2.z, p2) };
  const p3 = ramp(frame, T.steps[3], 0.9);
  cam = { cx: lerp(cam.cx, s3.cx, p3), cy: lerp(cam.cy, s3.cy, p3), z: lerp(cam.z, s3.z, p3) };

  const tx = CARD_W / 2 - cam.cx * cam.z;
  const ty = CARD_H / 2 - cam.cy * cam.z;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 1960, height: 1520, transformOrigin: '0 0', transform: `translate(${tx}px, ${ty}px) scale(${cam.z})` }}>
      <Img src={staticFile('app-listening.png')} style={{ width: 1960, height: 1520, display: 'block' }} />
      {STEPS.map((step, i) => {
        if (!step.shot) return null;
        const o = ramp(frame, T.steps[i] + 0.7, 0.3, 'out') * (1 - ramp(frame, stepEnd(i) - 0.25, 0.2, 'in'));
        const { x, y, w, h } = step.shot.ring;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              borderRadius: 6,
              border: `${3 / cam.z}px solid ${C.amber}`,
              boxShadow: '0 0 18px rgba(240, 164, 60, 0.45)',
              opacity: o,
            }}
          />
        );
      })}
    </div>
  );
}

// Feathered edges, so words the zoom cuts through fade out instead of ending on a hard edge.
const EDGE_FADE = 'linear-gradient(to right, transparent 0, black 9%, black 91%, transparent 100%)';

function Fade({ o, children, style }: { o: number; children: ReactNode; style?: CSSProperties }) {
  return o > 0.001 ? <div style={{ position: 'absolute', opacity: o, ...style }}>{children}</div> : null;
}

export function SetupPanel() {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  // Appears only once the picture has parked, and leaves before it grows back, so the two never overlap.
  const o = visible(frame, T.panelIn, T.stepsEnd, 0.4);
  if (o < 0.001) return null;
  const active = activeStep(t);
  const shot = ramp(frame, T.steps[1] - 0.2, 0.4);

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: o, fontFamily: SANS }}>
      <div style={{ position: 'absolute', left: 110, top: 280, width: 800, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STEPS.map((step, i) => {
          const glow = ramp(frame, T.steps[i], 0.3, 'out') * (1 - ramp(frame, stepEnd(i) - 0.1, 0.3));
          const state = i === active ? 'active' : i < active ? 'done' : 'upcoming';
          return <StepRow key={i} index={i} state={state} glow={glow} parts={step.parts} />;
        })}
      </div>

      <div style={{ position: 'absolute', left: COL_X, top: 350, fontSize: 22, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.legend3 }}>
        Step {Math.max(1, active + 1)} of 4
      </div>
      <div
        style={{
          position: 'absolute',
          left: COL_X,
          top: 390,
          width: CARD_W,
          height: CARD_H,
          overflow: 'hidden',
          borderRadius: 10,
          border: `1.5px solid ${C.seamStrong}`,
          background: C.rack,
        }}
      >
        <Fade o={1 - shot} style={{ inset: 0, display: 'grid', placeItems: 'center' }}>
          <InstallUnit frame={frame} />
        </Fade>
        <Fade o={shot} style={{ inset: 0, WebkitMaskImage: EDGE_FADE, maskImage: EDGE_FADE }}>
          <ScreenshotCamera frame={frame} />
        </Fade>
      </div>
      {STEPS.map((step, i) => (
        <Fade key={i} o={visible(frame, T.steps[i], stepEnd(i), 0.3)} style={{ left: COL_X, top: 860, width: CARD_W, fontSize: 32, color: C.legend2 }}>
          {step.detail}
        </Fade>
      ))}
    </div>
  );
}
