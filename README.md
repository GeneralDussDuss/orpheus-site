# orpheus-site

Showcase for **Orpheus** — a hi-res TIDAL player and GPU music visualizer for
[Omarchy](https://omarchy.org) + Hyprland.

**Live: https://generaldussduss.github.io/orpheus-site/**

Static HTML. No build step, no framework, no dependencies beyond Google Fonts.

## These are the real shaders

Every other page in the suite draws its product in CSS. This one doesn't have to.
`assets/viz.js` holds Orpheus's own fragment shaders — **prism, skyline, horizon,
tunnel and orb** — translated from Qt's GLSL 440 to GLSL ES 1.0. Same maths, same
helpers out of `_common.glsl`, same 32×40 spectrum history the app keeps on the
GPU. `assets/engine.js` feeds them 32 bands, falling peaks, a kick transient and
`flow`.

Three things had to change for the browser, all forced: the std140 uniform block
becomes loose uniforms, the packed vec4 bands become a 32×1 LINEAR texture (which
gives `band()` its interpolation for free), and the history feedback pass runs on
the CPU because a second render target is not worth it for 1280 bytes.

- A synthetic engine drives it by default — a kick on the beat, a snare off it,
  and a drifting high shimmer, so the terrain reads as music rather than noise.
- The pace buttons (89 / 104 / 174 BPM) change the tempo, and the world arrives
  faster. That is the project's whole thesis, provable on the page.
- **LIVE AUDIO** asks for the microphone and drives the shader from whatever is
  actually playing.
- Distance is integrated on the CPU and passed as `travel` — never `time × speed`,
  the same rule the real app follows.
- It stops drawing when scrolled out of view or when the tab is hidden.
- **It sizes itself to the machine.** The page profiles the device — pointer type
  and real touch capability, screen size, core count, reported memory, data-saver
  — and picks a render scale and frame cap from it: full DPR on a desktop, 1.05×
  at 45 fps on a tablet, 0.8× at 30 fps on a phone. Then it checks its own frame
  times and sheds resolution further if it guessed high. Every tier runs the same
  real shader; only the pixel count changes, so the hero's claim stays true on a
  phone. `prefers-reduced-motion` builds the world for a second and holds the frame.

`?still=1` is capture mode: it freezes the loop after ~170 drawn frames, preserves
the drawing buffer, reveals every scroll-triggered section (an IntersectionObserver
never fires during a screenshot run) and pins the hero to a fixed height so one
tall headless window captures the whole page.

## Pages

| Page | What's on it |
|---|---|
| `index.html` | Prism running live as the hero, what it is, the video section, the roadmap, and the one-line install |
| `visualizers.html` | One stage, all five shaders, cycled; the stack in nine sentences |

## Design

Part of the suite with CHARON, HYDRA and AETHER: Orbitron display, Rajdhani body,
JetBrains Mono labels, a named accent ramp, four glow tokens, `NN //` section
labels, letter-by-letter hero reveal, tilt cards, magnetic buttons and a `Ctrl+K`
palette.

Orpheus takes **blue** as its core and the Horizon sun as its warm highlight —
the only warm accent in the suite.

`assets/site.css` is the whole system. `assets/site.js` is the interaction layer.

## Media

Captures are unedited except for privacy redactions. Blurred out: a chat
notification, the signed-in account line, and — in `theme-sync` — the three
terminal panes either side of the player, which were working sessions and not
the subject. The theme switch is the point of that clip, and colour reads
through a blur.

No source code is in this repo.

## Licence

[CC BY-SA 4.0](LICENSE). Orpheus itself is a separate project, GPL-3.0-or-later.
