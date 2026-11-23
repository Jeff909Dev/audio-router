// One headline per beat, with short lines that replace each other underneath.
import { useCurrentFrame } from 'remotion';
import { BEAT, ramp, T, visible } from './timeline';
import { C, SANS } from './theme';

type Caption = { from: number; to: number; kicker: string; headline: string; subs: { at: number; text: string }[] };

const CAPTIONS: Caption[] = [
  {
    from: BEAT.problem[0] + 0.3,
    to: BEAT.problem[1],
    kicker: '01 · The problem',
    headline: 'You hear Ableton Live on your headphones.',
    subs: [{ at: T.problemSub, text: 'Your screen recorder gets none of it.' }],
  },
  {
    from: BEAT.router[0],
    to: BEAT.router[1],
    kicker: '02 · Audio Router',
    headline: 'Audio Router is a virtual cable.',
    subs: [
      { at: T.routerSub1, text: 'Apps play into OUT.' },
      { at: T.routerSub2, text: 'Recorders record from IN.' },
      { at: T.routerSub3, text: 'But now your headphones are silent.' },
    ],
  },
  {
    from: BEAT.listen[0],
    to: BEAT.listen[1],
    kicker: '03 · Listen on',
    headline: 'Listen on: hear it and record it.',
    subs: [{ at: T.listenSub, text: 'The signal splits to your headphones and the router at once.' }],
  },
  { from: BEAT.setup[0], to: BEAT.setup[1], kicker: '04 · Setup', headline: 'Set it up in four steps.', subs: [] },
  {
    from: BEAT.tip[0],
    to: BEAT.tip[1],
    kicker: '05 · Tip',
    headline: 'Put your mic on a DAW track.',
    subs: [{ at: T.tipSub, text: 'Voice and music share one mix, so the recorder needs one input.' }],
  },
];

export function Captions() {
  const frame = useCurrentFrame();
  return (
    <>
      {CAPTIONS.map((c) => {
        const o = visible(frame, c.from, c.to);
        if (o < 0.001) return null;
        const enter = ramp(frame, c.from, 0.5, 'out');
        return (
          <div key={c.kicker} style={{ position: 'absolute', left: 110, top: 66, width: 1700, opacity: o, fontFamily: SANS }}>
            <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '0.18em', textTransform: 'uppercase', color: C.legend3 }}>{c.kicker}</div>
            <div
              style={{
                marginTop: 10,
                fontSize: 64,
                fontWeight: 600,
                lineHeight: 1.1,
                color: C.legend,
                transform: `translateY(${(1 - enter) * 14}px)`,
              }}
            >
              {c.headline}
            </div>
            <div style={{ position: 'relative', marginTop: 12, height: 46 }}>
              {c.subs.map((sub, i) => {
                const next = c.subs[i + 1]?.at ?? c.to + 1;
                const so = visible(frame, sub.at, next, 0.3);
                const rise = ramp(frame, sub.at, 0.4, 'out');
                return (
                  <div
                    key={sub.text}
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      fontSize: 36,
                      color: C.legend2,
                      opacity: so,
                      transform: `translateY(${(1 - rise) * 10}px)`,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sub.text}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}
