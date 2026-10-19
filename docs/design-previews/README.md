# Design previews

Live WebGL previews of the three home-page directions plus the safe "standard" option. They are vanilla three.js (r186 from a CDN import map) and stand-alone: they are the visual and motion spec the React Three Fiber ports must match, not production code.

| File | Direction |
|---|---|
| `previews/keys.js` | Keycap Colorway |
| `previews/totems.js` | Glazed Component Totems |
| `previews/source.js` | Live Source |
| `previews/canon.js` | Studio Standard |
| `previews/common.js` | Stage, scroll-follow spring and device frame shared by all of them |
| `directions.json` (in `../plan`) | The written spec for each direction |
| `BRIEF.md` | The brief the previews were built to |
| `stills/` | Reference frames at each section, desktop (1440 wide) and phone (390 wide) |

## Run them

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/design-previews
```

Then open `http://127.0.0.1:4173/dev.html?m=keys` (or `totems`, `source`, `canon`). Add `&device=phone` for the phone frame, and `&jump=0.4` to pin the scroll position (0 to 1; sections sit at 0, 0.2, 0.4, 0.6, 0.8, 1).

`shoot.sh <id> [progress ...]` and `stills.sh <id> [progress ...]` take screenshots with headless Chrome (macOS path hard-coded) while that server runs. They write PNGs to `shots/` and `stills/`, which are git-ignored.

## Notes for porting

- The preview's `progress` is already the damped, speed-capped follower of scroll. In the real site that is `smoothDamp` in `src/lib/motion/damp.ts`, fed by the chapter float from `src/lib/scroll/chapters.ts`.
- Previews draw their copy into an overlay for convenience. In the real site all copy is server-rendered DOM and the canvas is decorative.
- Preview sections are fixed at six stations. The real site hides any section with no published records, so stations come from the rendered `[data-chapter]` elements.
- Everything in the previews labelled "Sample" is placeholder. None of it ships.
