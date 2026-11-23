// The loopback drawn as a patch cable between the device's OUT and IN jacks.
// It glows with the signal actually passing through (driven by the meter).
import { forwardRef } from 'react';

type Props = { outIsDefault: boolean; inIsDefault: boolean; live: boolean };

const JACK_Y = 54;

function Jack({ x, label, hint, isDefault }: { x: number; label: string; hint: string; isDefault: boolean }) {
  return (
    <g transform={`translate(${x} 0)`}>
      <text className="jack-label" x={0} y={12} textAnchor="middle">
        {label}
        {isDefault && <tspan className="jack-default"> · SYSTEM</tspan>}
      </text>
      <text className="jack-hint" x={0} y={27} textAnchor="middle">
        {hint}
      </text>
      <circle className="jack-ring" cx={0} cy={JACK_Y} r={13} />
      <circle className="jack-nut" cx={0} cy={JACK_Y} r={9} />
      <circle className="jack-hole" cx={0} cy={JACK_Y} r={4.5} />
      <rect className="plug" x={-5} y={JACK_Y + 6} width={10} height={14} rx={2} />
    </g>
  );
}

export const PatchCable = forwardRef<SVGSVGElement, Props>(function PatchCable({ outIsDefault, inIsDefault, live }, ref) {
  // The cable leaves each plug downward and sags between the jacks.
  const path = `M 46 ${JACK_Y + 18} C 46 150, 194 150, 194 ${JACK_Y + 18}`;
  return (
    <svg ref={ref} className="patch" data-live={live} viewBox="0 0 240 140" width={240} height={140} aria-hidden>
      <path className="cable-shadow" d={path} />
      <path className="cable-core" d={path} />
      <path className="cable-sheen" d={path} />
      <Jack x={46} label="OUT" hint="apps play here" isDefault={outIsDefault} />
      <Jack x={194} label="IN" hint="apps record here" isDefault={inIsDefault} />
    </svg>
  );
});
