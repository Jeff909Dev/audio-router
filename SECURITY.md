# Security

## What runs with elevated access

Audio Router installs code into a system process, so this page says exactly what it does.

- **The driver** is a Core Audio plug-in. The system audio server, `coreaudiod`, loads it from `/Library/Audio/Plug-Ins/HAL`. The driver copies audio buffers between its output and its input. It opens no files and makes no network connections.
- **Install and Uninstall** in the app ask for your password through the standard macOS prompt. With that password the app runs a fixed list of commands: `rm`, `cp`, `chown`, `xattr` and `killall coreaudiod`. The command list is in `changeDriver` in `app/electron/main.cjs`.
- **Microphone access** lets the app read the input of Audio Router for the level meters. The app records nothing and sends nothing anywhere. The app makes no network requests.
- **Listen on** creates a Multi-Output Device through the public Core Audio API. `arctl remove` deletes only devices that `arctl multi-output` created. Their UIDs start with `AudioRouter.multi.`.

## Supported versions

Only the latest release gets fixes.

## Report a vulnerability

Do not open a public issue for a security problem. Use **Report a vulnerability** on the [Security tab](https://github.com/Jeff909Dev/audio-router/security) of this repository. The report stays private until a fix is out.
