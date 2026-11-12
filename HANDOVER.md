# Calling Up: handover

A short browser game for a safety meeting. Each person plays their own run in their own browser:
a pre-trip walk-around at dusk, then a drive up a resource road in the dark and fog, calling on the
radio, understanding the calls they hear, and getting off the road onto firm ground before a loaded
logging truck comes down. A run takes about six minutes and ends with a personal summary.

Everything in the scenario is fictional. "Tamber" and "Corbel" are invented road names. There is
no company, person or real place anywhere in this repository, and it must stay that way: the
repository is public.

Contents: [Run, test, deploy](#run-test-deploy) · [Layout](#layout) · [The meeting link](#the-meeting-link) ·
[Editing the scenario](#editing-the-scenario) · [Reporting](#reporting-the-seam-for-a-backend) ·
[Graphics levels](#graphics-levels) · [Recording video](#recording-video) · [Real places](#real-places) ·
[Assets](#assets) · [How the engine is used](#how-the-engine-is-used) · [Radio and inspection content: sources](#radio-and-inspection-content-sources) ·
[Not confirmed](#not-confirmed) · [What was checked](#what-was-checked-and-what-was-not) · [Known weak spots](#known-weak-spots)

## Run, test, deploy

No build step and no dependencies to install: plain ES modules served as static files.

```
npm run dev      # http://localhost:8793  (PORT=xxxx to change). Also saves stills for the dev tools.
npm test         # node --test: rules, reporting, graphics controller, place seam (27 tests)
npm run deploy   # npx wrangler deploy: a static-assets Worker, see wrangler.jsonc
```

The Worker is called `resource-road` and serves `./public`. There are no secrets, bindings, logins
or databases. The page asks search engines not to index it.

## Layout

```
public/index.html, css/game.css     the page: canvas, cards, dash, captions (all text is page elements)
public/game/scenario.js             THE SCENARIO: every name, number and sentence. Edit this.
public/game/scenario-source.js      loads a scenario laid over the built-in one from ?scenario=
public/game/report.js               THE REPORTING SEAM: the one function to change to reach a backend
public/game/session.js              session code from the link, anonymous player id
public/game/main.js                 the game loop: world, cameras, vehicles, cards, sound, reporting
public/game/rules/                  pure, deterministic rules (no browser code), tested in node
    plan.js   what varies in a run, drawn from the seed (faults, which pullout is which, truck timing)
    run.js    the run itself: inspection, calls, heard calls, pull-over, outcome, summary
    drive.js  how the pickup drives on gravel      rng.js  seeded random numbers
    bot.js    scripted players (good, mud, rock, late, nearmiss, wrongcalls, careless)
public/game/quality.js              automatic graphics controller (pure, tested)
public/game/film.js, mp4mux.js      offline video capture
public/game/ui.js, icons.js, input.js, audio.js
public/game/world/                  the place and what stands in it
    place.js      where a scenario happens: terrain source + road line (the seam for real places)
    route.js      the road: centreline, grades, pullouts, carving it into the terrain
    corridor.js   road surface, ditches, pullouts      props.js   signs, boards, cones, stumps
    vehicles.js   pickup and logging truck             kit.js     shared shapes
    conditions.js weather and time of day              world.js   ties it to the engine; graphics levels
public/game/render/                 materials.js (game shaders), textures.js (scanned ground loader)
public/engine/, public/vendor/      the Mistline engine (a copy) and three.js r170
public/assets/ground/               scanned ground images (see CREDITS.md)
public/dev/                         development pages, not linked from the game
tests/                              node tests          tools/  dev server, texture conversion, road tools
shots/                              stills and clips (not in git)
```

## The meeting link

Everything a host needs goes in the link. Nobody needs to open a menu.

| In the link | What it does |
| --- | --- |
| `?s=CODE` | The session code (also `?session=`, `#s=`). Stamped on every reported event. It is also the seed: everyone with the same code meets the same faults, the same pullouts and the same truck. Without a code each run is random. |
| `?q=light` `?q=balanced` `?q=high` `?q=film` | Sets the graphics level for everyone who uses the link. See [Graphics levels](#graphics-levels). |
| `?scenario=ADDRESS` | A JSON file laid over the built-in scenario. See [Real places](#real-places). |
| `?mute=1`, `?voice=0` | No sound; no spoken radio calls. |

Example for a meeting with people at home on weak laptops: `https://<the site>/?s=NOV-MEETING&q=light`

For testing: `?debug=1` (log events, show numbers), `?auto=good|mud|rock|late|nearmiss|wrongcalls|careless`
(a scripted player plays), `?speed=N`, `?manual=1` (no frame loop; step with `__game.advance`),
`?tier=LEVEL` (start on a level but stay automatic), `?cond=NAME` (weather override), `?tex=0` (generated ground).

Controls: arrows or WASD to drive, R radio, C change view, Enter choose, 1 to 4 pick an answer,
M sound, Esc pause, G graphics (title screen only). Gamepad: left stick steers, right trigger
throttle, left trigger brake, A choose, X radio, Y view, Start pause.

Kept in the player's own browser storage only: `rr.player` (anonymous id), `rr.gfx` (their graphics
choice), `rr.autoTier`, `rr.mute`, `rr.view`.

## Editing the scenario

`public/game/scenario.js` is one commented data file. Sections, in order:

- `road`: road name, sign name, posted channel, the wrong channel for the radio fault, km numbering,
  whether up traffic calls even or odd km, vehicle word, the other road that shares the channel, where the run ends.
- `layout`: staging pad, the three pullouts (position, length, width), the MUST CALL sign, start position, speed limit.
- `location`: optional real place. `null` as shipped. See [Real places](#real-places).
- `look`: season, the dusk opening, and the weather for the drive. `condition` is one of `nightFog`
  (default), `nightClear`, `dusk`, `clearDay`, `coldSnow`, `rain`; `conditionTweaks` changes any part
  of it (for example `{ fog: { visibility: 60 } }`). `fogTop` is the altitude where ground fog thins
  out: the built-in road climbs from about 300 m, so a road that climbs above `fogTop` drives out of the fog.
  Each condition is defined in `public/game/world/conditions.js`.
- `truck`: where it starts, speed range, how close is a near miss.
- `inspection`: the five walk-around items, their prompts, answers, and what happens if a fault is missed;
  how many are faulty each run.
- `radio`: the call wording (templates), the three call points, the calls heard on the way up, the
  two "what does that call mean" questions with their answers, the "clear" and "rejoin" choices.
- `text`, `surfaces`, `debrief`, `summary`: every on-screen sentence.
- `decisions`: the catalogue of the 14 reported decisions with every possible choice and a label for dashboards.

After editing, run `npm test` (the scripted playthroughs read this file) and reload. If you change
radio wording, check it against the sign posted on your own road: the posted sign always governs.

## Reporting: the seam for a backend

The game does not talk to any server. `public/game/report.js` has one function, `deliver(event)`,
whose body is empty. Put the call to your backend there (it may be async; the game never waits for
it and a failure never stops a run). Nothing else needs to change. The event shapes are documented
at the top of that file:

- `run_start`: scenario id, seed, graphics level, and the plan (which items are faulty, which pullout is which).
- `decision`: `seq`, `id`, `choice`, `safe`, `ms`, `detail`. One per decision point.
- `run_end`: `outcome` (`clean`, `stuck`, `damaged`, `late`, `nearMiss`), `outcomes`, `safe`, `total`, `driveSeconds`, `durationMs`.

Every event carries `v`, `runId`, `session` (the code from the link, or null), `playerId`
(anonymous, random, per browser; no name and no login) and `at`.

Things a dashboard can rely on:

- Every finished run reports all 14 decision ids exactly once, whatever happened: failing early
  still plays the remaining decision points. The ids: `inspect.lights`, `inspect.tires`,
  `inspect.load`, `inspect.spare`, `inspect.radio`, `call.start`, `heard.other`, `call.mustcall`,
  `heard.truck`, `call.km2`, `pullout.choice`, `pullout.timing`, `call.clear`, `call.rejoin`.
- A run that is abandoned (tab closed, restarted) has a `run_start` and some decisions but no `run_end`.
- A restart is a new `runId` with the same `playerId`.
- For inspection items, "safe" depends on whether the item was faulty: see `detail.fault`.

To watch events while developing: `/dev/events.html?s=TEST` shows the game beside a live table of
what it reports. It is a development page, not part of the game, and stores nothing.

## Graphics levels

| Level | For | Ground images downloaded | Whole download (code gzipped) |
| --- | --- | --- | --- |
| Light | weak laptops | 0.32 MB (colour only, 512 px) | about 0.65 MB |
| Balanced | ordinary laptops | 1.12 MB (colour + relief, 512 px) | about 1.4 MB |
| High | a good graphics card | 4.09 MB (1024 px) | about 4.4 MB |
| Film | recording video offline, not for play | 13.2 MB (2048 px) | about 13.5 MB |

Each level only downloads its own images. The loading screen shows progress. If the images fail to
load the game draws its built-in generated ground instead.

**Automatic (no `?q=`):** the game guesses a starting level from the machine, then a controller
(`public/game/quality.js`) watches the real frame time for the whole run and moves quality down or
up a ladder of nine rungs (render resolution, fog detail, draw distance, cloud detail). Changing rung
only changes numbers the renderer already reads, so there is no pause. It steps down after about a
second of slow frames, tries a step up after four seconds of fast ones, and waits longer each time
a step up has to be undone (8 s, 20 s, 50 s, up to 4 minutes), so it does not flip back and forth.
Above the middle rung it gives up quality to reach 60 frames a second; below that it only gives up
more to stay above 30. If the bottom rung is still too slow, the next visit to the title screen
reloads once on the next lighter level.

**Set by the link (`?q=light|balanced|high`):** everyone starts on that level and the level is
shown on the title screen as set by the meeting link. The controller never goes above the level's
own starting quality, but it still steps down if the frame rate becomes unplayable, and comes back
up to that starting quality afterwards. The G key is off. (`?q=low` and `?q=medium` are accepted as
the old names for light and balanced.)

**A player's own choice (G on the title screen):** behaves the same as a level set by the link, for
that browser only.

**Film (`?q=film`):** everything at full quality, nothing held back, no adaptation. Too heavy to
play live on most machines; it exists for the recorder below.

Measured on one machine (Apple M1 Pro laptop, Chrome, a 1986 x 1188 window on a retina screen, the
graphics card shared with other work at the time), night-fog drive:

| Level | Settles at | Frame time | Notes |
| --- | --- | --- | --- |
| Light | its own rung, 1102 x 658 | 5 to 10 ms (60 fps) | 5.2 ms drive, 6.6 ms dusk opening when benchmarked |
| Balanced | top rung, 1584 x 946 | about 13 ms (60 fps) | |
| High | top rung, 1710 x 1022 | about 16 ms (60 fps, borderline) | sometimes two rungs down |
| Film | 3724 x 2228 | about 93 ms | offline only |

The dusk opening with clouds is the heaviest scene: High and Balanced drop to the middle rung there
(about 20 ms). Forcing the frame cost up three times made High step down to the middle rung within
about 4 seconds and return to the top within about 27 seconds after the load was removed; Light set
by the link stepped down two rungs under six times the load and returned to its own rung, never above.
None of this has been tried on a weak laptop.

## Recording video

Open the game with `?q=film&manual=1&mute=1` in Chrome or Edge (it needs WebCodecs), wait for the
title screen, and in the browser console:

```js
await __game.film.record({ move: 'pass', seconds: 16 })          // saves an .mp4 through the browser's downloads
await __game.film.record({ move: 'follow', seconds: 20, width: 3840, height: 2160 })
```

A scripted player drives to the right place, then every frame advances the game by exactly 1/fps
seconds however long it takes to draw, so the clip is smooth at any quality.

Options: `move` (`'cab'` the driver's view, `'follow'` behind and above the pickup, `'pass'` the
logging truck passing the pullout), `seconds` (12; 16 for pass), `fps` (30), `width`, `height`
(1920 x 1080), `bitrate`, `name`, `policy` (which scripted player; `good`), `at` (metres along the
road where cab and follow start; 320), `gap` (metres to the truck when pass starts; 60),
`save` (`'download'`, `'dev'` to write into `shots/tmp/` through the dev server, or `false` to get the bytes back).
`__game.film.progress` shows how far it is; `__game.film.stop()` ends early.

For a camera of your own: `__game.setShot([s, u, height], [s, u, height], fov)` places it in road
coordinates (metres along the road, metres right of the centreline, metres above), looking from
the first point to the second; `__game.setShot()` hands it back. Keep it out of the headlight beams.

Only the 3D picture is recorded. Cards, the speed and radio display and captions are page elements
and are not in the clip. There is no sound in the clip.

## Real places

The aim, later: play a scenario on the real road, with real elevation and satellite imagery. That
work is happening in the Mistline engine first. This game is ready for it in three ways.

**1. One seam for the place.** `public/game/world/place.js` decides the two things a place is made
of: a terrain source (a height for any position; today the engine's generated mountains) and a road
line (today traced over that terrain like a surveyed side-hill road). `route.js` builds the road
from any height function and, when given a line (`cfg.path`), follows it instead of tracing its own.
The rules, cards and reporting only know distances along the road, so none of them change.

**2. An optional `location` block in the scenario.**

```js
location: {
  name: 'for your own notes, never shown',
  centre: [lat, lon],                  // decimal degrees: the middle of the place
  road: [[lat, lon], [lat, lon], ...], // the centreline, in order of increasing kilometres (a GPS track, or the map's road line)
  zeroAt: 0,                           // metres along that line where the first kilometre board stands
  pullouts: [2110, 2260, 2410],        // metres from the first board to each pullout
  startHeading: 110,                   // compass degrees; only used when `road` is left out
}
```

Today, with the generated terrain, a location's road line is laid onto the generated mountains: the
shape of the road in plan is the real one, the ground under it is not. The game uses about
3.1 km of road after `zeroAt` and 180 m before it; a shorter line is continued straight at both ends.
A line that climbs above `look.fogTop` leaves the fog.

**3. The location comes from outside the repository.** This repository is public. **Never commit a
real incident location to it**, in the scenario file, a test, a JSON file or a commit message. Put the
location in a JSON file that lives somewhere private and name it in the link:

```
https://<the site>/?s=CODE&scenario=https://your-backend.example/scenarios/abc.json
```

The JSON has the same shape as `scenario.js` and holds only the parts that differ (objects are
merged, lists and values replaced). The game only fetches from its own site plus the origins listed
in `ALLOWED_ORIGINS` in `public/game/scenario-source.js`, which ships empty: add your backend's
origin there (an origin is not a secret and not a location), and let that server send the right
CORS header. Cookies are not sent. If the file cannot be loaded the game plays the built-in scenario.
A backend that hands out the session can hand out this address with it. Note that anyone with the
link can read that file, so protect it as you would the location itself.

`public/dev/demo-location.json` is a made-up example (a line drawn at latitude 0, longitude 0, in
the open ocean): try `/?scenario=/dev/demo-location.json`.

**What the real-terrain swap still needs** (mostly engine work, to be ported from Mistline):
real elevation in the engine's height grid at a resolution fine enough for a road bench (the grid
covers a 16 km square, so a road needs a finer local patch or a smaller square); the 16 km square
centred on `location.centre` (today a location is anchored on the generated road's start instead);
satellite colour on the distant land, blended into the close-up scanned ground near the road; tree
and plant placement from the imagery rather than the generated forest map; `fogTop` set per place;
and handling of sharp corners and switchbacks in a real road line, and of pullouts on the left.
On the game side that leaves `place.js` (return the real terrain and centre) and small changes in
`world.js`.

## Assets

The ground (gravel, mud, rock, wet soil, forest floor) uses five photo-scanned materials from Poly
Haven, all CC0. `CREDITS.md` lists each one with its page, author, licence and the exact files
downloaded. Only the converted images are in the repository (`public/assets/ground/`, 30 small WebP
files); `tools/convert-textures.py` makes them from the downloads. Everything else in the picture
(terrain, sky, fog, trees, vehicles, signs, sound) is made by code. No other asset libraries were used.

## How the engine is used

`public/engine/` and `public/vendor/` are a copy of the Mistline engine (weather, terrain, sky,
clouds, trees, post-processing) at its commit `1245c5d`. The game builds on it in `world/world.js`:
it hands the engine a hook that carves the road into the terrain, adds its own meshes (road,
props, vehicles), and drives the engine's weather dials from the scenario.

Engine files changed in this copy, and why:

| File | Change | Why |
| --- | --- | --- |
| `engine.js` | `hooks.terrain` (edit the height grid before it is uploaded); cloud drawing can be switched off; road mask uniforms; near-fog wiring; a fixed near plane; exposure gain and metering key | carve the road; a light level without clouds; keep trees off the road; headlights in fog; a cab camera; a night that stays dark |
| `gl/post.js` | cloud switch; an HDR fog target and the near-fog pass before bloom; night-vision desaturation limited to dark areas | headlight beams glow in fog and keep their colour |
| `gl/trees.js` | trees culled by the road mask; trees lit by the game's lamps; adjustable draw distance | no trees on the road; headlights light the forest; the graphics ladder |
| `gl/gamelight.js` (new) | lamps shared by all shaders (headlights with a dipped-beam shape, tail lights), snow cover | the vehicles' lights |
| `gl/nearfog.js` (new) | fog lit by those lamps, marched near the camera; falling rain | the headlights-in-fog look |

`public/game/mp4mux.js` is copied from Mistline unchanged.

## Radio and inspection content: sources

What the game teaches, and where it comes from. The provincial pages describe most resource roads
as radio-assisted, not radio-controlled, and say the sign posted on the road governs.

| In the game | Source |
| --- | --- |
| Call order: road name, kilometre, direction ("up" or "down"); vehicle type optional; number of vehicles if in a convoy | S1, S2, S13 |
| "Up" means kilometres increasing, "down" decreasing; not the grade, not loaded or empty | S1, S2, S6 |
| Call when starting, stopping, entering or leaving a road, at MUST CALL signs, and at the posted kilometres (example sign: up traffic calls even km, down traffic odd km) | S1, S2, S5, S14, S15 |
| "Stopped and in the clear at ... km", and call again when rejoining | S2, S14, S22 |
| Radio check before setting off: "Can anybody hear this radio?" | S3, S22 |
| Channel sign "ROAD CHANNEL" over the channel name; channels RR-1 to RR-35 | S5, S8a, S8b |
| Yield to industrial traffic; use pullouts; clear early | S9, S11, S18, S19, S20 |
| Do not rely on the radio alone: not everyone has one or calls | S1, S9, S11 |
| Headlights on at all times | S11, S18, S19 |
| Pre-trip items: lights, tires and lug nuts, load secured, spare, radio | S21, S20, S17 |

- S1 Province of BC, Resource road radio communications: https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/radio-communications
- S2 Radio protocol cards: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/radio-protocol-cards-june2010.pdf
- S3 Best practices for radio use, installation and maintenance: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/bmps_for_radio_use_installation_maintenance_final.pdf
- S4 Engineering manual: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/engineering-manual/engineering_manual.pdf
- S5 Forest service road signs: https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/engineering-standards-guidelines/forest-service-road-signs
- S6 Radio protocol pilot project results: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/radio_communications_protocol_for_res_rds_in_bc_pilot_proj_results__recommend_for_implementation.pdf
- S7 Forest Service Road Use Regulation: https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/70_2004
- S7b Motor Vehicle Act (as applied to resource roads): https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96318_05
- S8a ISED, BC resource road channels: https://ised-isde.canada.ca/site/spectrum-management-telecommunications/en/licences-and-certificates/conditions-licence-appendices/rr-british-columbia-resource-road-channels
- S8b Standardized RR channel notice: https://www.bcforestsafe.org/wp-content/uploads/2022/03/Standardized-RR-Channel-Notice-January-2022.pdf
- S9 BC Forest Safety Council, resource road safety: https://www.bcforestsafe.org/transportation/resource-road-safety-2/
- S10 Safe work procedure, logging truck and lowbed: https://www.bcforestsafe.org/wp-content/uploads/2021/02/swp_LoggingTruckAndLowbed.pdf
- S11 Resource road user safety guide: https://www.bcforestsafe.org/wp-content/uploads/2021/02/ps_ResourceRoadUserSafetyGuideBrochure.pdf
- S12 Communicate in the workplace: https://www.bcforestsafe.org/wp-content/uploads/2021/03/lng_1004_Communicate_in_the_Workplace.pdf
- S13 Resource road radio communications (archived, 2013): https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/archived/resrdradiocommunicationsnov28-2013.pdf
- S14 Quesnel radio calling: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/local-road-safety-information/quesnel/qruc-2_radio_calling.pdf
- S15 Stuart-Nechako radio calling protocol: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/local-road-safety-information/stuart-nechako/dja_doc2-radio_calling_protocol.pdf
- S16 WorkSafeBC OHS Regulation Part 26: https://www.worksafebc.com/en/law-policy/occupational-health-safety/searchable-ohs-regulation/ohs-regulation/part-26-forestry-operations
- S17 Off-highway vehicle guide: https://www.bcforestsafe.org/wp-content/uploads/2023/08/OHV-Final-Version-1.3.pdf
- S18 Skeena-Stikine, driving forest roads: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/local-road-safety-information/skeena-stikine/1_driving_forest_roads_watermark.pdf
- S19 Okanagan-Shuswap, driving forest roads: https://www2.gov.bc.ca/assets/gov/farming-natural-resources-and-industry/natural-resource-use/resource-roads/local-road-safety-information/okanagan-shuswap/okanagan_shuswap_driving_forest_roads.pdf
- S20 Safe work procedure, driving on resource roads: https://www.bcforestsafe.org/wp-content/uploads/2021/02/swp_xDrivingOnResourceRoads.doc
- S21 Light truck driver assessment: https://www.bcforestsafe.org/wp-content/uploads/2021/03/Light-Truck-Driver-Assessment.pdf
- S22 Radio calling (2018): https://www.bcforestsafe.org/wp-content/uploads/2021/03/Radio-Calling-Oct2018.pdf
- S23 Local road safety information: https://www2.gov.bc.ca/gov/content/industry/natural-resource-use/resource-roads/local-road-safety-information

## Not confirmed

Have someone who drives these roads read the scenario file before the meeting. These items are in
the game but were **not** found word for word in a source, or are the game's own invention:

- The radio check reply "Got you loud and clear" (the question is sourced; the reply is ours).
- The short form of the clear call and the exact rejoin wording: the game uses "stopped and in the
  clear at ... kilometre" and a normal position call on rejoining. A bare "[road] [km] clear" was not found.
- "Another road shares this channel" as the reason for the call you must ignore: it follows from
  the road name being the first word of every call, but is not quoted from a source.
- The figure "90 metres or more to stop" in the near-miss debrief.
- The game's own sign designs: the rules sign ("UP: CALL EVEN KM / DOWN: CALL ODD KM / CALL AT EVERY
  MUST CALL SIGN") and the orange "ACTIVE HAULING / YIELD TO LOGGING TRUCKS / USE PULLOUTS" sign. The
  yellow "ROAD CHANNEL" sign follows the provincial design.
- A pre-trip item worded "radio on the posted channel and tested": the assessment form lists the
  radio; the wording is ours.
- The truck slowing down because it heard your call at the 2 km board (a game mechanic), and the wait times after getting stuck or damaged.
- The debrief hints for reading ground by headlight (mud "shines wet", angular rock "throws hard shadows").
  No source gave explicit advice on testing a shoulder or reading a pullout's surface.
- Any legal right-of-way rule for loaded trucks: sources say to yield to industrial traffic; none read was a statute saying so.
- Fog- or night-specific radio rules: only one local protocol (S14) says to call more often in poor visibility.
- Not read: the BC Forest Safety Council's videos and its "Log Hauling Safe Driving Practices" document.
  Not found: a WorkSafeBC checklist for light vehicles; whether a shovel or tow strap is required;
  phrases for trailing vehicles ("one more behind me"); the design of LD channel signs.

## What was checked, and what was not

Checked: `npm test` (27 tests: a good run and each failure played by scripted players through the
pure rules, every run reporting all 14 decisions, the graphics controller against simulated machines,
the place seam and the scenario loader). In Chrome on the machine above, by automation with stills
looked at: a full good run and each of the six failing players to the summary screen; every weather
condition (`nightFog`, `nightClear`, `dusk`, `clearDay`, `coldSnow`, `rain`); each graphics level;
the controller under forced load; recording at 720p and 1080p; the demo location; the dev events page.

Not checked: a weak laptop; any browser other than Chrome; a real gamepad; the sound and the spoken
calls by ear; a phone or touch screen (the game needs a keyboard or gamepad); a person who is not a
script playing it.

## Known weak spots

1. The pickup and the logging truck are simple, flat-shaded shapes. In the dark and fog they read
   well; at dusk on the title screen and in daylight conditions they look plain next to the scanned ground.
2. In the driver's view the hood is a flat slab.
3. At night the mud pullout reads mostly as a darker patch with a faint sheen: telling it from firm
   gravel is harder than it should be for the lesson. Daylight conditions show the difference clearly.
4. Lamp glow in fog is not blocked by solid things, so the truck's headlight glow shows through its
   own cab when seen from behind.
5. The Light level has no clouds, so the dusk title scene is barer.
6. Trees, bark, rocks and stumps are still generated shapes, not scanned assets.

## Development helpers

- `/dev/look.html`: the world with no game on top, for tuning the look (`__look.snap(...)`).
- `/dev/events.html`: the game beside a live table of reported events.
- `/dev/playthrough.js`: `await import('/dev/playthrough.js')` on a page opened with `?manual=1`,
  then `await playthrough('good', 'name', { driveEvery: 25 })` plays a scripted run and saves stills
  to `shots/tmp/` through the dev server.
- `window.__game`: `begin()`, `advance(seconds)`, `tick(dt)`, `state`, `scene`, `events`, `setBot(name)`,
  `snap(name)`, `bench(n)`, `gov` (the graphics controller and its log), `setRung(i)`, `autoGraphics()`, `film`, `setShot(...)`.
- `tools/route-check.mjs`, `tools/map.mjs`: print and draw the road without a browser.
