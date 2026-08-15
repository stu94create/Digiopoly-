# 🔥🏙️🦙 Disaster Mayor

You are the newly elected Mayor of **Port Fiasco**, a charming miniature city with
excellent bagels and catastrophic luck. Survive a 7-day term while fires, floods,
sinkholes, llamas, rogue mascots and UFO tourists do their best to end it early.

A polished, self-contained browser game — no build step, no backend, no dependencies.
Works on desktop, iPhone and iPad (mouse, keyboard and touch).

**Play it:** open `disaster-mayor/index.html` via any static host (GitHub Pages works
out of the box: `https://<user>.github.io/<repo>/disaster-mayor/`).

## Features (Version 2)

**Strategy**
- Limited emergency units — 2 fire engines, 2 police, 1 medical team, 2 repair crews.
  A dispatched crew stays busy until its incident is done, so you must prioritise.
- Cascading consequences: fires spread to neighbouring buildings, floods damage roads
  (which slow every vehicle including your crews), low safety feeds chaos, and neglected
  infrastructure makes every disaster grow faster and crews work slower.
- Named districts that matter: residential areas feel happiness/safety hits harder,
  Midtown commerce bleeds budget, The Works (industrial) burns hotter, and trouble in
  the Civic Quarter slows Mayor's Desk cooldowns.
- Absurd disasters with real mechanics: llamas physically block roads, giant pigeons
  suppress city income, UFO gawkers congest whole blocks, the parade float gridlocks
  a major intersection, the coffee crisis makes desk actions dearer and slower, and
  the mascot's panic accelerates chaos once he escalates.
- Six Mayor's Desk trade-offs including Overtime Shift (faster crews, unhappier crews)
  and Call In Reserves (one extra unit of everything, briefly, for a price).

**Visuals**
- Distinct district looks (green residential, paved commercial, sandstone civic plaza,
  gravel industrial with smoking factory chimneys), streetlights that glow at night —
  and go dark in a blackout — crosswalks, a landmark fountain, cracked damaged roads.
- Dramatic disaster FX: real flames, water spreading onto damaged streets, storm debris,
  UFO spotlight cone, and a numeric severity chip on every map marker.
- Emergency vehicles with distinct liveries, dashed route lines and siren pulse rings.

**Accessibility (built for VoiceOver play)**
- Quick command bar + shortcuts: City Status (C), Incidents (I), Services (S), Desk (M).
- The map is a single accessible summary, not thousands of tile stops; incidents live in
  a semantic list sorted most-urgent-first, each one stop with severity and crew status.
- Careful live announcements (new/escalating/resolved incidents, crew arrivals, danger
  thresholds) with Minimal / Standard / Detailed verbosity in Settings.
- Focus management: modals trap and restore focus, the report takes focus at game end,
  and acting on an incident keeps you oriented in the list.
- Every button self-describes with effect, cost, cooldown and unavailability reasons.
- Opening any menu or dialog pauses the simulation — reading is never punished.
- Reduce Motion setting (defaults to your OS preference), 44px+ touch targets.

Plus everything from V1: day/night cycle, pause/2× speed, pan/pinch-zoom,
end-of-term ranked Mayor's Report, and localStorage autosave/continue.

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
