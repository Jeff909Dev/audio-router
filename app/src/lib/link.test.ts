import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Device } from './bridge.ts';
import { linkOf, listenCandidates } from './link.ts';

const dev = (uid: string, name: string, transport: string, inputChannels: number, outputChannels: number): Device => ({
  id: 0,
  uid,
  name,
  manufacturer: 'Test',
  transport,
  inputChannels,
  outputChannels,
  sampleRate: 48000,
  sampleRates: [48000],
  isDefaultInput: false,
  isDefaultOutput: false,
  isDefaultSystemOutput: false,
});

const mic = dev('BuiltInMicrophoneDevice', 'MacBook Pro Microphone', 'built-in', 1, 0);
const speakers = dev('BuiltInSpeakerDevice', 'MacBook Pro Speakers', 'built-in', 0, 2);
const router2 = dev('AudioRouter2ch_UID', 'Audio Router 2ch', 'virtual', 2, 2);
const router16 = dev('AudioRouter16ch_UID', 'Audio Router 16ch', 'virtual', 16, 16);
const speakersLink = dev(
  'AudioRouter.multi.BuiltInSpeakerDevice+AudioRouter2ch_UID',
  'MacBook Pro Speakers + Audio Router 2ch',
  'aggregate',
  0,
  2,
);
const rekordbox = dev('com.Pioneer DJ.rekordbox Aggregate Device', 'rekordbox Aggregate Device', 'aggregate', 0, 2);

test('linkOf finds the multi-output made for this router and its listen device', () => {
  assert.deepEqual(linkOf([mic, speakers, router2, speakersLink, rekordbox], 'AudioRouter2ch_UID'), {
    multi: speakersLink,
    listenUid: 'BuiltInSpeakerDevice',
    listen: speakers,
  });
});

test('linkOf ignores a multi-output made for another router', () => {
  assert.equal(linkOf([speakers, router2, router16, speakersLink], 'AudioRouter16ch_UID'), null);
});

test('linkOf keeps listen uids that contain "+" and spaces whole', () => {
  const scarlett = dev('AppleUSBAudioEngine:Focusrite:Scarlett 2i2+ 4th Gen:1', 'Scarlett 2i2', 'usb', 2, 2);
  const multi = dev(
    'AudioRouter.multi.AppleUSBAudioEngine:Focusrite:Scarlett 2i2+ 4th Gen:1+AudioRouter2ch_UID',
    'Scarlett 2i2 + Audio Router 2ch',
    'aggregate',
    0,
    2,
  );
  const link = linkOf([scarlett, router2, multi], 'AudioRouter2ch_UID');
  assert.equal(link?.listenUid, 'AppleUSBAudioEngine:Focusrite:Scarlett 2i2+ 4th Gen:1');
  assert.equal(link?.listen, scarlett);
});

test('linkOf still reports a link whose listen device is unplugged', () => {
  const link = linkOf([router2, speakersLink], 'AudioRouter2ch_UID');
  assert.equal(link?.multi, speakersLink);
  assert.equal(link?.listenUid, 'BuiltInSpeakerDevice');
  assert.equal(link?.listen, undefined);
});

test('linkOf returns null when the router has no multi-output', () => {
  assert.equal(linkOf([mic, speakers, router2, rekordbox], 'AudioRouter2ch_UID'), null);
  assert.equal(linkOf([], 'AudioRouter2ch_UID'), null);
});

test('listenCandidates offers real outputs only', () => {
  const usb = dev('usb-interface', 'Scarlett 2i2 USB', 'usb', 2, 2);
  const airpods = dev('airpods', 'AirPods Pro', 'bluetooth', 1, 2);
  const zoom = dev('zoom.us.zoomaudiodevice.001', 'ZoomAudioDevice', 'virtual', 2, 2);
  const uids = listenCandidates([mic, speakers, router2, speakersLink, usb, airpods, zoom, rekordbox]).map((d) => d.uid);
  assert.deepEqual(uids, ['BuiltInSpeakerDevice', 'usb-interface', 'airpods']);
});
