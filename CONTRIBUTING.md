# Contributing

Bug reports and pull requests are welcome. For a large change, open an issue first so we can agree on the approach.

## Build from source

You need macOS 13 or later, Xcode 16 or later for Swift 6, and Node.js 24 or later. The driver and `arctl` also run on macOS 11 and 12, but the app needs macOS 13 because of Electron.

```sh
make          # driver bundles, the arctl helper and the app
make test     # driver tests in-process, then the app's unit tests
make demo     # the app with fake devices, no driver install needed
make dev      # the real app with hot reload
```

`make test` does not install anything. It loads each driver bundle inside the test process.

## Test a driver change on your Mac

1. Run `make test`.
2. Install the build with the **Install** button in `make dev`, or run `sudo make -C driver install V=2ch` in Terminal.
3. Run `make -C driver e2e`. It plays a quiet tone into Audio Router 2ch and checks that the input returns the same level and frequency. Nothing plays through your speakers.

To check a Multi-Output Device, pass its UID: `make -C driver e2e PLAY='AudioRouter.multi.<headphones-uid>+AudioRouter2ch_UID'`. `helper/build/arctl list` prints every UID.

## Change the UI

Read `.interface-design/system.md` first. It lists the tokens, components, and spacing that the app uses. To check a screen without clicking, run `AR_DEMO=1 AR_SCREENSHOT=/tmp/shot.png npx electron .` in `app/` after `npm run build`.

## Pull requests

- Keep one change per pull request.
- Say how you tested it. For driver changes, include the output of `make test` and `make -C driver e2e`.
- Run `make test` before you push. CI runs the same command.
