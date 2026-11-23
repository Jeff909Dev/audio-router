// Last beat: the camera has pushed in on the router unit; the name and the link sit under it.
import { useCurrentFrame } from 'remotion';
import { ramp, T } from './timeline';
import { C, MONO, SANS } from './theme';

export function EndCard() {
  const frame = useCurrentFrame();
  const title = ramp(frame, T.endText, 0.6, 'out');
  const link = ramp(frame, T.endText + 0.4, 0.6, 'out');
  if (title < 0.001) return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 772, display: 'flex', flexDirection: 'column', alignItems: 'center', fontFamily: SANS }}>
      <div style={{ fontSize: 58, opacity: title, transform: `translateY(${(1 - title) * 14}px)`, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 600, color: C.legend }}>Audio Router</span>
        <span style={{ color: C.legend2 }}> · free and open source for macOS</span>
      </div>
      <div
        style={{
          marginTop: 30,
          fontFamily: MONO,
          fontSize: 36,
          fontWeight: 500,
          color: C.amber,
          padding: '12px 26px',
          background: C.well,
          border: `1.5px solid ${C.amberEdge}`,
          borderRadius: 6,
          opacity: link,
          transform: `translateY(${(1 - link) * 14}px)`,
        }}
      >
        github.com/Jeff909Dev/audio-router
      </div>
    </div>
  );
}
