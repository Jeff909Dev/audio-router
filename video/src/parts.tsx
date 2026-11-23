// SVG hardware primitives, redrawn from the app: rack unit, jack, plug, patch cable, LED, meter.
import { createContext, type CSSProperties, type ReactNode, useContext } from 'react';
import { interpolateColors } from 'remotion';
import { type Box, CABLE, cableCurve, EAR, JACK, lengthOf, pathOf, PLUG, type Port, type Pt, S } from './layout';
import type { LedState } from './scene';
import { C, MONO, SANS } from './theme';

// Opacity of secondary labels. The parked thumbnail hides them, since they would be too small to read.
export const MinorOpacity = createContext(1);

type TextProps = {
  x: number;
  y: number;
  size: number;
  weight?: number;
  fill?: string;
  spacing?: number;
  mono?: boolean;
  anchor?: 'start' | 'middle' | 'end';
  upper?: boolean;
  minor?: boolean;
  children: ReactNode;
};

export function Label({ x, y, size, weight = 400, fill = C.legend, spacing = 0, mono, anchor = 'start', upper, minor, children }: TextProps) {
  const minorOpacity = useContext(MinorOpacity);
  const style: CSSProperties = {
    fontFamily: mono ? MONO : SANS,
    fontSize: size,
    fontWeight: weight,
    letterSpacing: spacing,
    textTransform: upper ? 'uppercase' : undefined,
    fontVariantNumeric: mono ? 'tabular-nums' : undefined,
  };
  return (
    <text x={x} y={y} fill={fill} textAnchor={anchor} style={style} opacity={minor ? minorOpacity : undefined}>
      {children}
    </text>
  );
}

// A rack unit: faceplate with an ear and two screws on each side.
export function Unit({ box, ear = EAR, children }: { box: Box; ear?: number; children?: ReactNode }) {
  const { x, y, w, h } = box;
  const screws: Pt[] = [];
  for (const ex of [x + ear / 2, x + w - ear / 2]) for (const ey of [y + 20, y + h - 20]) screws.push({ x: ex, y: ey });
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={10} fill={C.faceplate} stroke={C.seam} strokeWidth={1.5} />
      <line x1={x + ear} y1={y} x2={x + ear} y2={y + h} stroke={C.seamSoft} strokeWidth={1.5} />
      <line x1={x + w - ear} y1={y} x2={x + w - ear} y2={y + h} stroke={C.seamSoft} strokeWidth={1.5} />
      {screws.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={5.5} fill={C.well} stroke={C.seamStrong} strokeWidth={1.5} />
      ))}
      {children}
    </g>
  );
}

export function Divider({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke={C.seamSoft} strokeWidth={1.5} />;
}

export function Jack({ at }: { at: Pt }) {
  return (
    <g>
      <circle cx={at.x} cy={at.y} r={JACK.ring} fill={C.raised} stroke={C.seamStrong} strokeWidth={1.5} />
      <circle cx={at.x} cy={at.y} r={JACK.nut} fill={C.jackNut} stroke="rgba(0, 0, 0, 0.6)" strokeWidth={1.5} />
      <circle cx={at.x} cy={at.y} r={JACK.hole} fill={C.jackHole} />
    </g>
  );
}

function Plug({ at }: { at: Port }) {
  const angle = (Math.atan2(at.dir.y, at.dir.x) * 180) / Math.PI - 90;
  return (
    <rect
      x={-PLUG.w / 2}
      y={PLUG.from}
      width={PLUG.w}
      height={PLUG.len}
      rx={2 * S}
      fill={C.plug}
      stroke={C.seamStrong}
      strokeWidth={1.5}
      transform={`translate(${at.x} ${at.y}) rotate(${angle})`}
    />
  );
}

// The signature: a patch cable that glows amber with the signal it carries. Light pulses travel a → b.
export function Cable({ a, b, signal, flow, reach, sag, opacity = 1 }: { a: Port; b: Port; signal: number; flow: number; reach?: number; sag?: number; opacity?: number }) {
  const curve = cableCurve(a, b, reach, sag);
  const d = pathOf(curve);
  const len = lengthOf(curve);
  const s = Math.max(0, Math.min(1, signal));
  const core = interpolateColors(s, [0, 1], [C.cableOff, C.amber]);
  return (
    <g opacity={opacity}>
      <path d={d} fill="none" stroke="rgba(0, 0, 0, 0.55)" strokeWidth={CABLE.shadow} strokeLinecap="round" transform={`translate(0 ${3 * S})`} />
      <path
        d={d}
        fill="none"
        stroke={core}
        strokeWidth={CABLE.core}
        strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 ${(s * 7 * S).toFixed(2)}px rgba(240, 164, 60, 0.55))` }}
      />
      {s > 0.02 && len > 40 && (
        <path
          d={d}
          fill="none"
          stroke="rgb(255, 222, 170)"
          strokeOpacity={0.6 * s}
          strokeWidth={CABLE.core * 0.42}
          strokeLinecap="round"
          strokeDasharray="18 86"
          strokeDashoffset={-flow}
        />
      )}
      <path d={d} fill="none" stroke="rgba(255, 255, 255, 0.08)" strokeWidth={CABLE.sheen} strokeLinecap="round" transform={`translate(0 ${-1.6 * S})`} />
      <Plug at={a} />
      <Plug at={b} />
    </g>
  );
}

const LED_COLOR: Record<LedState, string> = { off: 'rgba(255, 255, 255, 0.1)', ok: C.ledSafe, fault: C.ledClip };
const LED_GLOW: Record<LedState, string> = { off: 'none', ok: 'drop-shadow(0 0 6px rgba(87, 211, 132, 0.7))', fault: 'drop-shadow(0 0 6px rgba(255, 91, 79, 0.7))' };

export function Led({ x, y, state, label, size = 21 }: { x: number; y: number; state: LedState; label: string; size?: number }) {
  return (
    <g>
      <circle cx={x + 6} cy={y - size * 0.36} r={6} fill={LED_COLOR[state]} style={{ filter: LED_GLOW[state] }} />
      <Label x={x + 22} y={y} size={size} weight={500} spacing={size * 0.12} fill={state === 'off' ? C.legend3 : C.legend2} upper minor>
        {label}
      </Label>
    </g>
  );
}

// LED ladder like the app's meter: safe < hot < clip, unlit segments at alpha .09.
export function Meter({ x, y, w, h, level, segments = 20 }: { x: number; y: number; w: number; h: number; level: number; segments?: number }) {
  const gap = 3;
  const sw = (w - gap * (segments - 1)) / segments;
  const lit = Math.round(Math.max(0, Math.min(1, level)) * segments);
  return (
    <g>
      {Array.from({ length: segments }, (_, i) => {
        const f = (i + 1) / segments;
        const color = f <= 0.7 ? C.ledSafe : f <= 0.9 ? C.ledHot : C.ledClip;
        return <rect key={i} x={x + i * (sw + gap)} y={y} width={sw} height={h} rx={1.5} fill={color} opacity={i < lit ? 1 : 0.09} />;
      })}
    </g>
  );
}

// Right-pointing arrow, drawn because the bundled latin subset has no U+2192.
export function Arrow({ size = 28, color = 'currentColor', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 28 17" style={style} aria-hidden>
      <path d="M 1 8.5 H 25 M 18 2 L 25 8.5 L 18 15" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
