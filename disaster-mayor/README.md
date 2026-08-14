# 🔥🏙️🦙 Disaster Mayor

You are the newly elected Mayor of **Port Fiasco**, a charming miniature city with
excellent bagels and catastrophic luck. Survive a 7-day term while fires, floods,
sinkholes, llamas, rogue mascots and UFO tourists do their best to end it early.

A polished, self-contained browser game — no build step, no backend, no dependencies.
Works on desktop, iPhone and iPad (mouse, keyboard and touch).

**Play it:** open `disaster-mayor/index.html` via any static host (GitHub Pages works
out of the box: `https://<user>.github.io/<repo>/disaster-mayor/`).

## Features (first playable version)

- Animated canvas city: pseudo-3D buildings, moving cars & citizens, day/night cycle,
  emergency vehicles with flashing lights that actually drive the road network to incidents
- 12 disasters (5 realistic, 7 absurd), each with flavour text, escalation,
  multiple responses and catastrophic consequences if ignored (burned-out rubble,
  permanently broken roads…)
- City stats: population, budget, happiness, safety, infrastructure and chaos
- Mayor's Desk: global actions with cooldowns (press conference, fund drive, road
  and utility works)
- Pause, 2× speed, pan/pinch-zoom, tap-to-inspect buildings, keyboard controls
- End-of-term Mayor's Report with ranks from **Beloved Mayor** to **Resign Immediately**
- localStorage saving: continue game (autosave), best results, settings

## Controls

| Input | Action |
|---|---|
| Drag / arrow keys | Pan the map |
| Scroll / pinch / `+` `−` | Zoom |
| Tap / click | Inspect buildings & incidents |
| `Space` | Pause |
| `1` / `2` | Game speed |
| `Esc` | Pause menu |

## Architecture

Plain ES modules, no framework:

```
disaster-mayor/
├── index.html         shell: HUD, incident panel, menus, modals
├── css/style.css      all UI styling & responsive layout
└── js/
    ├── main.js        bootstrap, game loop, wiring
    ├── state.js       game state, simulation tick, win/lose, scoring
    ├── citygen.js     seeded city generation, road graph, pathfinding, names
    ├── events.js      disaster definitions, spawning, escalation, responses
    ├── traffic.js     cars, pedestrians, emergency vehicle dispatch
    ├── render.js      canvas renderer: city layer, FX, particles, markers
    ├── input.js       pointer pan/zoom/tap + keyboard
    ├── ui.js          DOM: HUD, cards, ticker, modals, report
    ├── save.js        localStorage persistence
    └── utils.js       shared helpers
```

Adding a new disaster is one entry in `EVENTS` (`js/events.js`) plus, optionally,
a visual effect case in `incidentFX` (`js/render.js`). Everything else —
spawning, escalation, cards, markers, consequences — picks it up automatically.
