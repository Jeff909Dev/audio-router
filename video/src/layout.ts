// Geometry of the one picture the whole video is built on, in 1920x1080 canvas units.
export type Pt = { x: number; y: number };
// A jack position plus the direction its plug points out of the jack.
export type Port = Pt & { dir: Pt };
export type Box = { x: number; y: number; w: number; h: number };

// Jack and cable sizes are PatchCable.tsx scaled by S.
export const S = 1.7;
export const JACK = { ring: 13 * S, nut: 9 * S, hole: 4.5 * S };
export const PLUG = { w: 10 * S, from: 6 * S, len: 14 * S };
export const CABLE = { core: 6 * S, shadow: 9 * S, sheen: 1.4 * S, start: 18 * S };
export const EAR = 28;

export type CardId = 'daw' | 'mic' | 'split' | 'router' | 'hp' | 'rec';

export const CARD: Record<CardId, Box> = {
  daw: { x: 110, y: 430, w: 480, h: 300 },
  mic: { x: 110, y: 800, w: 480, h: 130 },
  split: { x: 640, y: 290, w: 260, h: 170 },
  router: { x: 880, y: 520, w: 520, h: 450 },
  hp: { x: 1440, y: 270, w: 400, h: 180 },
  rec: { x: 1440, y: 700, w: 400, h: 200 },
};

const L = { x: -1, y: 0 };
const R = { x: 1, y: 0 };
const U = { x: 0, y: -1 };
const D = { x: 0, y: 1 };

export const PORT = {
  dawOut: { x: 525, y: 600, dir: R },
  dawMic: { x: 525, y: 686, dir: D },
  micOut: { x: 525, y: 866, dir: U },
  splitIn: { x: 690, y: 400, dir: L },
  splitHp: { x: 846, y: 364, dir: R },
  splitRouter: { x: 846, y: 430, dir: D },
  routerOutExt: { x: 1000, y: 740, dir: L },
  routerOutLoop: { x: 1000, y: 740, dir: D },
  routerInLoop: { x: 1280, y: 740, dir: D },
  routerInExt: { x: 1280, y: 740, dir: R },
  hpIn: { x: 1505, y: 362, dir: L },
  recIn: { x: 1505, y: 800, dir: L },
} satisfies Record<string, Port>;

// Carries a plug from one jack to another along a smooth path through `via`, which keeps it clear of the
// units' labels, while its direction turns from a's to b's.
export function travel(a: Port, b: Port, t: number, via: Pt[] = []): Port {
  const pts: Pt[] = [a, ...via, b];
  const n = pts.length - 1;
  const u = Math.min(n - 1e-6, Math.max(0, t * n));
  const i = Math.floor(u);
  const f = u - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[i + 1];
  const p3 = pts[Math.min(n, i + 2)];
  // Catmull-Rom through the points.
  const at = (k: 'x' | 'y') =>
    0.5 *
    (2 * p1[k] +
      (p2[k] - p0[k]) * f +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f +
      (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * f * f * f);
  const dx = a.dir.x + (b.dir.x - a.dir.x) * t;
  const dy = a.dir.y + (b.dir.y - a.dir.y) * t;
  const len = Math.hypot(dx, dy) || 1;
  return { x: t >= 1 ? b.x : at('x'), y: t >= 1 ? b.y : at('y'), dir: { x: dx / len, y: dy / len } };
}

// Routes around the router unit, whose top-left corner is at (880, 520).
export const VIA = {
  hpToRouter: [{ x: 1180, y: 400 }, { x: 845, y: 470 }, { x: 848, y: 690 }],
  routerToSplit: [{ x: 858, y: 716 }, { x: 846, y: 560 }, { x: 618, y: 478 }],
  splitToRouter: [{ x: 850, y: 690 }],
} satisfies Record<string, Pt[]>;

// A free plug held just in front of its source jack, before it is carried anywhere.
export const nearby = (p: Port, dist = 70): Port => ({ x: p.x + p.dir.x * dist, y: p.y + p.dir.y * dist, dir: { x: -p.dir.x, y: -p.dir.y } });

export type Bezier = [Pt, Pt, Pt, Pt];

// A patch cable leaves each plug along the plug's direction and sags under its own weight.
export function cableCurve(a: Port, b: Port, reach?: number, sag?: number): Bezier {
  const p0 = { x: a.x + a.dir.x * CABLE.start, y: a.y + a.dir.y * CABLE.start };
  const p3 = { x: b.x + b.dir.x * CABLE.start, y: b.y + b.dir.y * CABLE.start };
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const k = reach ?? Math.min(320, Math.max(60, dist * 0.45));
  const g = sag ?? dist * 0.12;
  return [
    p0,
    { x: p0.x + a.dir.x * k, y: p0.y + a.dir.y * k + g },
    { x: p3.x + b.dir.x * k, y: p3.y + b.dir.y * k + g },
    p3,
  ];
}

export const pathOf = ([p0, p1, p2, p3]: Bezier) =>
  `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;

export function lengthOf([p0, p1, p2, p3]: Bezier): number {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= 32; i++) {
    const t = i / 32;
    const u = 1 - t;
    const p = {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}
