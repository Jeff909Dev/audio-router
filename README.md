# Audio Router

A virtual loopback audio driver for macOS (in the spirit of BlackHole) plus a control app.
Everything an app plays into **Audio Router Nch** comes back out as an input on the same device:
DAW → OBS, browser → recorder, and so on. No added latency and no resampling.

```
driver/   AudioServerPlugIn in C (.driver bundle loaded by coreaudiod)
helper/   arctl: Swift CLI over CoreAudio (list devices, set default, sample rate, multi-output)
app/      Electron + React: install/uninstall, routing, listening and meters
```

## Usage

```sh
make                 # build the 2ch and 16ch drivers, arctl and the app
make test            # in-process loopback tests for the driver + app tests
make demo            # app with a fake device, no install needed
make dev             # real app with hot reload
```

To install the driver, use the **Install** button in the app (it asks for your admin password),
or from the terminal:

```sh
sudo make -C driver install V=2ch     # or V=16ch
sudo make -C driver uninstall V=2ch
```

Both restart `coreaudiod`, so sound drops for about a second.

## Listen while you record

Whatever plays into Audio Router reaches the recorder but not your ears. To hear it as well, pick
your headphones under **Listen on**. The app asks `arctl multi-output` for a Multi-Output Device
named `<headphones> + Audio Router 2ch`, which plays the same audio on both with no added latency.
It keeps working with the app closed. **Off** removes it.

To record Ableton Live with a screen recorder:

1. In Ableton, set Settings › Audio › Output Device to `<headphones> + Audio Router 2ch`.
2. In the recorder, pick `Audio Router 2ch` as the microphone.
3. For your mic, put it on an Ableton track with monitoring on, so it reaches the output with the rest.

**Use as sound output** sends the rest of the Mac's sound through the same device.

## How it works

- **Driver** (`driver/src/AudioRouter.c`): a device with one input stream and one output stream of N
  Float32 channels. `WriteMix` writes the output mix into a ring buffer indexed by sample time,
  and `ReadInput` reads that same sample time back (and zeroes it, so the input returns silence
  instead of repeating old audio when nothing is playing). The clock is virtual:
  `GetZeroTimeStamp` advances one ring period (65536 frames) for every equivalent amount of
  `mach_absolute_time`.
- **Sample rate**: 44.1 to 192 kHz. Changes go through `RequestDeviceConfigurationChange`, as
  Core Audio requires.
- **Variants**: the channel count is fixed at compile time (`AR_CHANNELS`). Each variant has its
  own factory UUID and device UID, so several can be installed at once.
- **App**: the main process runs `arctl` and `osascript … with administrator privileges`. The
  renderer opens the device's input with `getUserMedia` for the meters and plays nothing itself.
  **Listen on** runs `arctl multi-output` and `arctl remove`. The app never stores the choice: on
  every poll it finds the Multi-Output Device in Core Audio's device list by its UID,
  `AudioRouter.multi.<listen uid>+<router uid>`.

## Limitations

- The driver is signed ad-hoc (`codesign -s -`). That is enough to load it locally; distributing
  it to other Macs requires a Developer ID signature and notarization.
- Packaging the app (`.app`/`.dmg`) is not set up yet; `main.cjs` already resolves paths from
  `process.resourcesPath` when `app.isPackaged`.
- No volume/mute control on the device (the system volume keys don't affect it).

The code is an independent implementation on top of Apple's `AudioServerPlugIn.h` API; it does not
reuse BlackHole source code.
