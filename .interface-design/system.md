# Audio Router — interface system

## Direction
Studio rack gear. Each driver variant is a rack unit faceplate (with rack ears and screw holes), the
meters are LED ladders, and the loopback is drawn as a patch cable. Dark, precise and calm. Color
only appears when it means something: signal, state or the current choice.

**User:** someone streaming or recording on a Mac who needs to know three things at a glance: is
the driver loaded, is signal passing, and where the Mac's sound is going.

**Signature:** the OUT→IN patch cable (`PatchCable.tsx`). It glows amber in proportion to the level
actually arriving at IN, driven every frame by the meter through the `--signal` CSS variable (0..1).
It does not re-render React.

## Tokens (`app/src/styles.css`)
Named after the hardware, not after generic roles.

| Token | Value | Use |
|---|---|---|
| `--rack` | `#0d0e0f` | window background (the rack) |
| `--faceplate` | `#141517` | rack unit surface |
| `--faceplate-raised` | `#1b1c1f` | buttons, dropdown lists (one level above) |
| `--faceplate-hover` | `#212226` | button hover |
| `--well` | `#09090a` | inset areas: meter, rate selector, picker, chips |
| `--legend` … `--legend-4` | warm off-white `rgba(238,231,214, .94/.66/.44/.24)` | text: primary, secondary, labels, meta/disabled |
| `--seam-soft` / `--seam` / `--seam-strong` | white at `.04/.075/.12` | border progression |
| `--amber` | `#f0a43c` | **the only accent**: current selection, signal, system route |
| `--amber-wash` / `--amber-edge` | amber at `.08/.36` | accent fill and border |
| `--led-safe` / `--led-hot` / `--led-clip` | `#57d384` / `#f0a43c` / `#ff5b4f` | LEDs and meter zones only |

Rule: inputs and readouts are **darker** than the faceplate (`--well`) because they are inset.
Never put a pure white surface on the faceplate.

## Depth
Borders only, using low-opacity rgba. No shadows, except the dropdown list (`0 10px 28px rgba(0,0,0,.5)`)
and the LED and cable glow, which represent light.

## Typography
- `IBM Plex Sans Condensed` (400/500/600) for silkscreen legends. Field labels and states are
  uppercase, 10–11px, with letter-spacing `.12–.18em`.
- `IBM Plex Mono` (400/500) for numbers (kHz, channels, dB, model badge), with `tabular-nums`.
- Unit title is 15px/600. Body text is 12.5–13px.

## Spacing and radius
- Unit header: `14px 18px`. Body: `16px 18px 14px`. Controls: `14px 18px 16px`.
- Gap between units: `14px`. Between fields: `26px` horizontal, `14px` vertical. Between buttons: `6px`.
- Radius: `--r-s: 3px` (buttons, selectors, chips), `--r-m: 6px` (units, dropdown list).

## Components
- **RackUnit**: grid `22px | 1fr | 22px` (ears with 2 screws each). Has three zones separated
  by `--seam-soft`: header (model badge `AR·N`, title, LED status, primary action),
  body (cable 240px + meter), controls (Rate / Route / Listen on).
  When not installed it shows a description instead of the body, and only one primary action.
- **LED status** (`Led`): 7px dot with a glow, plus an uppercase label. States: `off/ok/warn/fault`.
- **Meter**: canvas, 48 segments from −60 to 0 dBFS. Zones: safe < −12 ≤ hot < −3 ≤ clip.
  Unlit segments are drawn at alpha .09 and the peak-hold segment is lit. The scale is HTML
  underneath. Row height depends on channel count (12/9/7px).
- **RateSelector**: segmented control inside a `--well`. The selected rate gets amber text, `--amber-wash`
  and an inset `--amber-edge` ring.
- **Picker**: custom dropdown (no native `<select>`). The trigger is `--well`, the list is `--faceplate-raised`.
- **PanelButton**: uppercase 11px. Tones: `plain`, `primary` (amber, the main action), `danger`
  (turns red only on hover).
- **Patchbay chips** `OUT`/`IN`: the active one is solid amber with `--rack` text. Unavailable ones
  are at opacity .28.
- **Usage line** (`.usage`): one line under the controls while a Listen on device is set. It names
  the exact devices to pick in Ableton and in the recorder. Text is `--legend-3` at 12px, device
  names `--legend-2` at weight 500. No amber: it explains, it does not mark a state.
- **Advice**: amber-washed strip for situations where the user won't hear anything (Mac output
  going into the loopback), always with a corrective action.
