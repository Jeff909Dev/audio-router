// Types for the bridge exposed by electron/preload.cjs.

export type Device = {
  id: number;
  uid: string;
  name: string;
  manufacturer: string;
  transport: string;
  inputChannels: number;
  outputChannels: number;
  sampleRate: number;
  sampleRates: number[];
  isDefaultInput: boolean;
  isDefaultOutput: boolean;
  isDefaultSystemOutput: boolean;
};

export type Variant = {
  id: string;
  channels: number;
  name: string;
  uid: string;
  built: boolean;
  installed: boolean;
};

export type AppState = {
  variants: Variant[];
  devices: Device[];
  error: string | null;
  demo: boolean;
};

export type Result = { ok: true } | { ok: false; cancelled?: boolean; message?: string };

export type DefaultKind = 'output' | 'input' | 'system';

type Bridge = {
  getState(): Promise<AppState>;
  install(id: string): Promise<Result>;
  uninstall(id: string): Promise<Result>;
  setDefault(kind: DefaultKind, uid: string): Promise<Result>;
  setRate(uid: string, rate: number): Promise<Result>;
  multiOutput(listenUid: string, routerUid: string): Promise<Result>;
  removeMultiOutput(uid: string): Promise<Result>;
  requestMic(): Promise<boolean>;
};

declare global {
  interface Window {
    audioRouter: Bridge;
  }
}

export const bridge = (): Bridge => window.audioRouter;
