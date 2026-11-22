# Twotone

A calm daily logic puzzle. Fill the grid with **suns** and **moons** so that:

1. every row and column holds the same number of each,
2. no more than two of the same sit side by side (across or down),
3. cells joined by **=** match and cells joined by **×** are opposite.

Every puzzle has exactly one solution and can be solved by logic alone — no guessing.

## Modes

- **Daily**: one puzzle per day, the same for everyone (seeded from your local date). It has a timer, a streak of consecutive daily solves, and a share button that copies a spoiler-free result such as `Twotone #12 ☀️🌙 1:42 ⭐ no hints`. Size rotates by weekday: Mon 6×6 Easy, Tue/Thu 6×6 Hard, Wed/Fri/Sat 8×8, and a big 10×10 on Sunday.
- **Practice**: endless puzzles in 6×6 Easy, 6×6 Hard, 8×8 Medium and 10×10 Expert, with best times (no-hint solves only).
- **Race the bots**: the same puzzle against three computer opponents, each clearly labelled **BOT** and shown as a progress bar. Bots follow the logic solver's real step order at different speeds and pause to "think" on harder deductions. Each hint you take in a race adds 15 s to your time, and the results say how close it was.

Play features: tap cycles empty → sun → moon → empty; drag to paint; undo; a two-step explained **hint** (the first press points at a cell and explains the rule, e.g. "Row 3 already has 3 moons — the rest must be suns.", and the second press fills it in; a wrong cell is cleared first); rule-break highlighting that can be toggled; a gentle ripple when a line is completed; a win animation; WebAudio sound effects with a mute toggle; light and dark themes; full keyboard support.

Keyboard: arrows move · `S`/`1` sun · `M`/`2` moon · `Space`/`Enter` cycle · `Backspace`/`0` clear · `Z` or `Ctrl+Z` undo · `H` hint · `E` toggle checks · `R` clear board · `Esc` back · `?` how to play.

## Run locally

No build step and no dependencies:

```sh
python3 -m http.server 8831 -d docs
# open http://localhost:8831/
```

## Tests

```sh
node --test tests/*.test.js   # pure logic: uniqueness on 60 seeds per difficulty, solver, hints, bots, daily, streaks
node tests/e2e.mjs            # headless Chrome: every mode start to finish at 1280x800, 390x844 (touch) and 960x540
```

`tests/e2e.mjs` loads Playwright from a sibling checkout (`../triangulate/node_modules`) and Chrome from `/usr/bin/google-chrome`. It is a dev-only tool and is not a dependency of the game. Screenshots go to `/workspace/arcade-shots/twotone/` (override with `SHOTS=`).

## Deploy to GitHub Pages

The whole site lives in `docs/` and uses only relative paths, so it works from a sub-path such as `https://<user>.github.io/twotone/`.

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then select branch `main` and folder `/docs`.
3. The "More games" link points to `../arcade/` (the sibling studio hub).

## Project layout

```
docs/                 deployable static site
  index.html          markup, inline SVG icon sprites, OG/meta tags
  css/style.css       all styles (light + dark themes, responsive layouts)
  js/logic.js         PURE game logic: seeded RNG, generator, logic solver, hints, validation, daily, streaks, bots
  js/board.js         board rendering + pointer/drag input
  js/app.js           screens, game controller, persistence, results/share
  js/audio.js         WebAudio synth sound effects
  js/store.js         localStorage wrapper
  favicon.svg, icon-*.png, og.png
tests/                unit tests (node --test) and the Playwright e2e
tools/                dev helpers: bench, screenshots, OG image renderer
```

## How puzzles are made

`generate(difficulty, seed)` in `docs/js/logic.js`:

1. Builds a random valid full grid row by row from the precomputed list of valid line patterns.
2. Starts from all cells given plus a random subset of the true `=`/`×` edge clues.
3. Removes clues one at a time (givens tend to go first, so the edge clues do more of the work). A removal is kept only if the **logic-only solver** can still finish the puzzle using the techniques allowed for that difficulty:
   - *Easy*: basic rules only (match/oppose across a clue, no-three pairs and gaps, completing a line's count).
   - *Hard / Medium / Expert*: adds line analysis ("if this were a sun, this row couldn't be completed"). Hard 6×6 must need it at least twice.
4. Because every solver step is a sound deduction, a logic-solvable puzzle has exactly one solution. The unit tests also check this with an independent exhaustive solution counter on 60 seeds per difficulty.

Generation takes about 2–35 ms in Node, so puzzles are made on the fly. The daily is `generate(dailyDiff(date), "daily-" + date)`.

## Credits & licenses

- Code, art (inline SVG icons, logo) and sound (synthesised at runtime with WebAudio) are original to this project. Released under the MIT License (see `LICENSE`).
- No third-party data, fonts, images or libraries ship with the game. It uses the system font stack only, makes no network requests at runtime, and has no analytics.
- The puzzle genre is the classic binary/"Takuzu"-style grid puzzle with edge clues, a traditional public puzzle form.
