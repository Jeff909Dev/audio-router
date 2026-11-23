import { useCallback, useEffect, useState } from 'react';
import { bridge, type AppState, type Device } from './lib/bridge';
import { RackUnit } from './components/RackUnit';
import { Patchbay } from './components/Patchbay';

const isRouter = (d: Device) => d.uid.startsWith('AudioRouter');

// Where "Back to …" sends sound: built-in speakers first, else any real output.
function fallbackOutput(devices: Device[]) {
  const outputs = devices.filter((d) => d.outputChannels > 0 && !isRouter(d));
  return outputs.find((d) => d.transport === 'built-in') ?? outputs[0];
}

export function App() {
  const [state, setState] = useState<AppState | null>(null);

  const refresh = useCallback(async () => {
    setState(await bridge().getState());
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  if (!state) return <div className="boot">Reading Core Audio…</div>;

  const out = state.devices.find((d) => d.isDefaultOutput);
  const inp = state.devices.find((d) => d.isDefaultInput);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="wordmark">
          <strong>Audio Router</strong>
          <span>virtual loopback</span>
        </div>
        <div className="grow" />
        <dl className="routing">
          <div>
            <dt>Sound out</dt>
            <dd data-router={(out && isRouter(out)) || undefined}>{out?.name ?? '—'}</dd>
          </div>
          <div>
            <dt>Sound in</dt>
            <dd data-router={(inp && isRouter(inp)) || undefined}>{inp?.name ?? '—'}</dd>
          </div>
        </dl>
        {state.demo && <span className="demo-tag">Demo</span>}
      </header>

      <main className="rack">
        {state.error && <p className="fault">{state.error}</p>}
        {state.variants.map((v) => (
          <RackUnit
            key={v.id}
            variant={v}
            devices={state.devices}
            fallbackOutput={fallbackOutput(state.devices)}
            demo={state.demo}
            onChanged={refresh}
          />
        ))}
        <Patchbay devices={state.devices} onChanged={refresh} />
      </main>
    </div>
  );
}
