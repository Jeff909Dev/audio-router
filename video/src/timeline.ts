// Every moment of the story, in seconds. The whole picture is derived from these.
import { Easing, interpolate } from 'remotion';

export const FPS = 30;
export const DURATION = 48 * FPS;

export const BEAT = {
  problem: [0, 6],
  router: [6, 14],
  listen: [14, 21],
  setup: [21, 36.2],
  tip: [36.2, 42.5],
  end: [42.5, 48],
} as const;

export const T = {
  cardsIn: 0.1,
  dawToHp: 0.6,
  problemSub: 2.6,

  routerIn: 6.2,
  routerSub1: 7.6,
  replugToRouter: 7.9,
  routerSub2: 9.9,
  inToRec: 10.1,
  routerSub3: 12.0,

  listenOpen: 15.0,
  listenHover: 15.5,
  listenPick: 16.1,
  splitIn: 16.4,
  replugToSplit: 16.9,
  splitOuts: 17.8,
  listenSub: 18.0,

  shrink: 21.0,
  panelIn: 21.8,
  steps: [22.2, 25.7, 29.2, 32.7],
  stepsEnd: 36.2,

  micIn: 37.4,
  micCable: 38.0,
  tipSub: 38.9,

  endZoom: 42.5,
  endText: 43.5,
} as const;

export type Kind = 'inOut' | 'out' | 'in' | 'linear';

const EASE: Record<Kind, (t: number) => number> = {
  inOut: Easing.inOut(Easing.cubic),
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.cubic),
  linear: (t) => t,
};

// 0 before `start` seconds, 1 after `start + dur`, eased in between.
export function ramp(frame: number, start: number, dur: number, kind: Kind = 'inOut'): number {
  return interpolate(frame / FPS, [start, start + dur], [0, 1], {
    easing: EASE[kind],
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

// Fades in at `from`, out at `to`.
export function visible(frame: number, from: number, to: number, fade = 0.35): number {
  return Math.min(ramp(frame, from, fade, 'out'), 1 - ramp(frame, to - fade, fade, 'in'));
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
