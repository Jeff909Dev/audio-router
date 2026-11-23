// A router's "link" is the Multi-Output Device that arctl makes from a listen
// device (your headphones) and the router: apps that play into it are heard
// and recorded at once. It is derived from Core Audio's device list on every
// poll, never stored.
import type { Device } from './bridge';

export const MULTI_PREFIX = 'AudioRouter.multi.';

export type Link = { multi: Device; listenUid: string; listen: Device | undefined };

// The uid `arctl multi-output <listenUid> <routerUid>` gives the device it makes.
export const multiUidOf = (listenUid: string, routerUid: string) => `${MULTI_PREFIX}${listenUid}+${routerUid}`;

export function linkOf(devices: Device[], routerUid: string): Link | null {
  const suffix = `+${routerUid}`;
  const multi = devices.find((d) => d.uid.startsWith(MULTI_PREFIX) && d.uid.endsWith(suffix));
  if (!multi) return null;
  // Listen uids may contain any character, '+' included, so cut by the known ends.
  const listenUid = multi.uid.slice(MULTI_PREFIX.length, -suffix.length);
  return { multi, listenUid, listen: devices.find((d) => d.uid === listenUid) };
}

// Bluetooth headphones are offered too. They add 150–250 ms of latency, which
// you feel when playing an instrument live, but are fine for listening back.
export function listenCandidates(devices: Device[]): Device[] {
  return devices.filter(
    (d) => d.outputChannels > 0 && d.transport !== 'aggregate' && d.transport !== 'virtual' && !d.uid.startsWith('AudioRouter'),
  );
}
