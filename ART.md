# Art

Every drawn thing on the site is a named sprite. Until you supply a drawing, a
placeholder drawn in code is used.

## Replacing a placeholder

1. Draw it. Transparent PNG. Match the slot's **shape** (the ratio in the table)
   or it'll be letterboxed inside it, centred. Resolution: the slot grows to fit
   your drawing, up to 4× the listed size; anything bigger is scaled down. 4× is
   plenty for anything big on screen (gifts, ornaments, creatures, the star); the
   listed size is fine for small/soft things (glows, flakes, puffs).
2. Save it as `art/<name>.png`, e.g. `art/link/gift-1-box.png` (make the folders).
3. Add the name to `art/manifest.json`, e.g. `["link/gift-1-box", "tree/needles-0"]`.

## Things to know

- **Leave a margin** on soft things (needles, snow caps, puffs, glows). Near the
  camera they're blurred, and anything touching the edge gets cut off square.
  `tree/needles-*` and `tree/snowcap-*` are drawn into the middle ~62% of their
  slot automatically, so draw those edge-to-edge in your own file.
- **Needles** should be a mid-tone green. The scene darkens, warms, cools and fogs
  them itself; if you draw them dark and moody they'll end up black.
- **Snow caps** sit exactly on top of the needle cluster with the same number
  (`snowcap-2` goes over `needles-2`). Draw them on top of your needle drawing,
  then save just the snow layer.
- **`fx/*`** are drawn white and coloured in code. Keep them white.
- **Hanging things** (ornaments, canes, lantern) hang from the point given in the
  notes, so put the hook/string there.
- **Creatures** are drawn without eyes. The eyes are added in code at the spots in
  the notes so they can follow the cursor.
- `link/*` are the clickable ones. `deco/*` are scenery.

## Sprites

| name | base slot (px) | notes |
|---|---|---|
| `tree/needles-0` | 128×128 | needle cluster, mid-green, lit/shaded by the shader |
| `tree/needles-1` | 128×128 | needle cluster, mid-green, lit/shaded by the shader |
| `tree/needles-2` | 128×128 | needle cluster, mid-green, lit/shaded by the shader |
| `tree/needles-3` | 128×128 | needle cluster, mid-green, lit/shaded by the shader |
| `tree/snowcap-0` | 128×128 | snow lying on top of tree/needles-N; drawn over it, same frame |
| `tree/snowcap-1` | 128×128 | snow lying on top of tree/needles-N; drawn over it, same frame |
| `tree/snowcap-2` | 128×128 | snow lying on top of tree/needles-N; drawn over it, same frame |
| `tree/snowcap-3` | 128×128 | snow lying on top of tree/needles-N; drawn over it, same frame |
| `tree/trunk` | 64×1024 | whole trunk, base at bottom, tip at top; tapers to a point |
| `fx/glow` | 64×64 | soft light halo, white |
| `fx/flake` | 64×64 | snowflake, white |
| `fx/disc` | 32×32 | hard circle (eyes) |
| `fx/shadow` | 64×32 | contact shadow under gifts |
| `fx/shaft` | 32×256 | light shaft, white |
| `fx/puff-0` | 128×96 | mist / cloud puff, white, very soft edges |
| `fx/puff-1` | 128×96 | mist / cloud puff, white, very soft edges |
| `fx/puff-2` | 128×96 | mist / cloud puff, white, very soft edges |
| `fx/rays` | 256×256 | star burst rays, white |
| `deco/ball-0` | 96×150 | decorative ornament; hook point = top centre |
| `deco/ball-1` | 96×150 | decorative ornament; hook point = top centre |
| `deco/ball-2` | 96×150 | decorative ornament; hook point = top centre |
| `deco/ball-3` | 96×150 | decorative ornament; hook point = top centre |
| `deco/ball-4` | 96×150 | decorative ornament; hook point = top centre |
| `deco/ball-5` | 96×150 | decorative ornament; hook point = top centre |
| `link/ornament-1` | 96×150 | clickable ornament; hook point = top centre |
| `link/ornament-2` | 96×150 | clickable ornament; hook point = top centre |
| `link/ornament-3` | 96×150 | clickable ornament; hook point = top centre |
| `link/ornament-4` | 96×150 | clickable ornament; hook point = top centre |
| `deco/cane` | 64×192 | decorative candy cane; hangs from a point 36% across, 4% down |
| `link/cane-1` | 64×192 | clickable candy cane; hangs from a point 36% across, 4% down |
| `link/cane-2` | 64×192 | clickable candy cane; hangs from a point 36% across, 4% down |
| `deco/gift-0-box` | 128×128 | box body (stretched to each gift's size) |
| `deco/gift-0-lid` | 128×64 | lid + bow; bottom edge sits on the box |
| `deco/gift-1-box` | 128×128 | box body (stretched to each gift's size) |
| `deco/gift-1-lid` | 128×64 | lid + bow; bottom edge sits on the box |
| `deco/gift-2-box` | 128×128 | box body (stretched to each gift's size) |
| `deco/gift-2-lid` | 128×64 | lid + bow; bottom edge sits on the box |
| `deco/gift-3-box` | 128×128 | box body (stretched to each gift's size) |
| `deco/gift-3-lid` | 128×64 | lid + bow; bottom edge sits on the box |
| `deco/gift-4-box` | 128×128 | box body (stretched to each gift's size) |
| `deco/gift-4-lid` | 128×64 | lid + bow; bottom edge sits on the box |
| `deco/gift-5-box` | 128×128 | box body (stretched to each gift's size) |
| `deco/gift-5-lid` | 128×64 | lid + bow; bottom edge sits on the box |
| `link/gift-1-box` | 128×128 | clickable gift body |
| `link/gift-1-lid` | 128×64 | clickable gift lid + bow; flies off on click |
| `link/gift-2-box` | 128×128 | clickable gift body |
| `link/gift-2-lid` | 128×64 | clickable gift lid + bow; flies off on click |
| `link/gift-3-box` | 128×128 | clickable gift body |
| `link/gift-3-lid` | 128×64 | clickable gift lid + bow; flies off on click |
| `link/gift-4-box` | 128×128 | clickable gift body |
| `link/gift-4-lid` | 128×64 | clickable gift lid + bow; flies off on click |
| `link/creature-1` | 128×128 | clickable creature, NO eyes (eyes are added and follow the cursor at 37%/53% across, 40% down); sits on its bottom edge |
| `link/creature-2` | 128×128 | clickable creature, NO eyes (eyes are added and follow the cursor at 37%/53% across, 40% down); sits on its bottom edge |
| `link/star` | 128×128 | the star on top, centred |
| `deco/lantern` | 64×128 | hanging lantern at the middle stops; hangs from top centre; glow is added in code |
