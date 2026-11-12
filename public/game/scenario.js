// ============================================================================================
// THE SCENARIO. Everything specific to this training scenario lives in this one file:
// road name, radio channel, call wording, kilometre markers, pullouts, inspection items,
// debrief text, and the catalogue of decisions the game reports.
//
// You can edit any text or number here without touching the engine or the game code.
// After editing, run `npm test` (the scripted playthroughs read this file) and reload.
//
// EVERYTHING HERE IS FICTIONAL. "Tamber" and "Corbel" are invented road names. Replace them with
// your own if you want, but check the radio wording against the sign posted on your road:
// the posted sign always governs. Sources for the procedure are listed in HANDOVER.md.
//
// Distances: `s` is metres along the road from the first kilometre board (the road entry).
// The road model is about 3 km long (s from -180 to 3080); keep things inside -60 .. 2950.
// ============================================================================================

export const SCENARIO = {
  id: 'resource-road-v1',
  title: 'Calling Up',
  subtitle: 'A resource road, after dark, in fog.',

  // ---- the road -----------------------------------------------------------------------------
  road: {
    name: 'Tamber',                 // spoken in every call and printed on every board
    signName: 'TAMBER MAIN',        // printed on the entry sign
    channel: 'RR-12',               // the posted road channel (resource road channels are RR-1 .. RR-35)
    wrongChannel: 'RR-27',          // what the radio is left on when the "radio" fault is in play
    startKm: 0,                     // number on the first board (the road entry)
    kmSpacing: 1000,                // metres between boards. Real boards are 1 km apart.
    upCalls: 'even',                // posted rule on the entry sign: UP traffic calls even km, DOWN calls odd km
    vehicle: 'pickup',              // vehicle type you add to your calls (optional under the provincial protocol)
    otherRoad: 'Corbel',            // a different road that shares the channel (for the call you must ignore)
    endS: 2900,                     // the run ends here
  },

  // Staging area (flat pad on the downhill side, before the first board) and the three pullouts.
  // One pullout is firm, one is mud, one is loose rock; which is which is drawn from the session seed.
  layout: {
    pad: { s0: -62, s1: -10, width: 19 },
    pullouts: [
      { s: 2110, length: 36, width: 4.5 },
      { s: 2260, length: 36, width: 4.5 },
      { s: 2410, length: 36, width: 4.5 },
    ],
    mustCallS: 985,                 // where the MUST CALL sign stands (just before the 1 km board)
    speedLimit: 50,                 // km/h shown on the dash as the sensible ceiling for this road
  },

  // ---- weather and light ---------------------------------------------------------------------
  // Engine dials. `dusk` is the opening view from the staging area; `night` is the drive.
  look: {
    season: 0.8,
    dusk: { time: 17.25, moisture: 0.62, cloudBase: 880, inversion: 0.15, temperature: 9, windDir: 275, windSpeed: 6, precip: 0.1, highCloud: 0.45, haze: 0.32 },
    night: { time: 20.4 },
    fog: { visibility: 95, top: 372, topSoftness: 16 },   // metres you can see; altitude where the fog thins out
  },

  // ---- the logging truck -----------------------------------------------------------------------
  truck: {
    startKm: 3,                     // where it is when you hear its last call before the meeting
    speed: [5.6, 6.4],              // m/s, drawn from the seed (about 20 to 23 km/h, loaded, downhill, in fog)
    startJitter: [-50, 50],         // metres, drawn from the seed: moves where it meets you
    easedSpeed: 4.4,                // m/s once the driver knows where you are (you called at the last board)
    sightDistance: 42,              // metres at which neither of you can avoid a near miss if you are still on the road
  },

  // ---- pre-trip inspection ---------------------------------------------------------------------
  // The seed picks `faultCount` of these to be faulty. `view` names a camera station in the game.
  // Wording follows the BC Forest Safety Council light truck driver assessment (see HANDOVER.md).
  inspection: {
    faultCount: [2, 3],
    intro: 'Walk around the truck before you go. Some things are wrong tonight. Look, then decide.',
    skipLabel: 'Skip it. You are already late.',
    doLabel: 'Do the walk-around',
    items: [
      { id: 'inspect.lights', view: 'front', label: 'Lights',
        prompt: 'Headlights on. Are they all working?',
        okChoice: 'All working', faultChoice: 'One is out: fix it',
        truthFault: 'The right headlight was out.', truthOk: 'Both headlights were working.',
        fixed: 'Bulb changed. Both headlights working.',
        missed: 'You drove with one headlight. In fog that halves what you can see and makes you look like a motorcycle to the truck.' },
      { id: 'inspect.tires', view: 'wheel', label: 'Tires',
        prompt: 'Front left tire: inflation, tread, lug nuts.',
        okChoice: 'Looks right', faultChoice: 'It is soft: pump it up',
        truthFault: 'The front left tire was soft.', truthOk: 'The tires were sound.',
        fixed: 'Tire inflated to the placard pressure.',
        missed: 'You drove on a soft front tire. The steering pulled left all the way up the road.' },
      { id: 'inspect.load', view: 'box', label: 'Load',
        prompt: 'Everything in the back secured?',
        okChoice: 'Secured', faultChoice: 'Loose: strap it down',
        truthFault: 'The fuel can and tool case were loose in the box.', truthOk: 'The load was strapped down.',
        fixed: 'Fuel can and tool case strapped down.',
        missed: 'The loose fuel can and tool case were thrown around the box on the rough road.' },
      { id: 'inspect.spare', view: 'spare', label: 'Spare tire',
        prompt: 'Spare tire: is it inflated?', gauge: { ok: 60, fault: 14, placard: 60, unit: 'psi' },
        okChoice: 'Good to go', faultChoice: 'It is flat: sort it out',
        truthFault: 'The spare was nearly flat.', truthOk: 'The spare was at pressure.',
        fixed: 'Spare swapped for one at pressure.',
        missed: 'The spare was flat. If you cut a tire tonight you are waiting for help in the dark.' },
      { id: 'inspect.radio', view: 'radio', label: 'Radio',
        prompt: 'Radio: is it on the channel posted for this road?',
        okChoice: 'It is fine', faultChoice: 'Wrong channel: switch and do a radio check',
        truthFault: 'The radio was on {wrongChannel}. The sign says {channel}.', truthOk: 'The radio was on {channel}, as posted.',
        fixed: 'Radio on {channel}. Radio check: "Can anybody hear this radio?" Answered.',
        missed: 'Your radio was on {wrongChannel}, not {channel}. Nobody heard your first call and you did not hear the truck call at 5 km.' },
    ],
  },

  // ---- radio ------------------------------------------------------------------------------------
  // Call format (provincial default): road name, kilometre, direction, vehicle type (optional).
  // "Up" = kilometres increasing, "down" = kilometres decreasing. It is not about the grade or the load.
  radio: {
    callTemplate: '{road}, {km} kilometre, {dir}, {vehicle}.',
    clearTemplate: '{road}, {vehicle} stopped and in the clear at {km} kilometre.',
    truckTemplate: '{road}, {km} kilometre, down, logging truck.',
    otherTemplate: '{otherRoad}, 9 kilometre, down, logging truck.',
    checkCall: 'Can anybody hear this radio?',
    checkReply: 'Got you loud and clear.',
    window: [-70, 150],             // a call counts for a call point if made between these offsets (m) from it
    // where you must call. kind: 'entry' (starting / entering the road), 'mustcall' (sign), 'board' (posted even km)
    callPoints: [
      { id: 'call.start', km: 0, kind: 'entry', label: 'Call when you enter the road (0 km)' },
      { id: 'call.mustcall', km: 1, kind: 'mustcall', label: 'Call at the MUST CALL sign (1 km)' },
      { id: 'call.km2', km: 2, kind: 'board', label: 'Call at the 2 km board (even km, going up)' },
    ],
    // calls you hear on the way up (s = where you are when you hear them)
    heard: [
      { id: 'heard.far', s: 300, from: 'truck', km: 5, needsRadio: true },
      { id: 'heard.other', s: 620, from: 'other', question: true },
      { id: 'heard.truck', s: 1470, from: 'truck', km: 3, question: true, startsTruck: true },
    ],
    questions: {
      'heard.other': {
        ask: 'What does that call mean for you?',
        options: [
          { id: 'other-road', text: 'Nothing. That is {otherRoad}, a different road on the same channel.', safe: true },
          { id: 'ahead', text: 'A truck is coming down this road toward me.', safe: false },
          { id: 'behind', text: 'A truck is behind me, going my way.', safe: false },
        ],
        right: 'The first word of every call is the road name. {otherRoad} shares this channel but it is not your road.',
      },
      'heard.truck': {
        ask: 'What does that call mean for you?',
        options: [
          { id: 'ahead', text: 'A logging truck is above me, coming down toward me. Find a pullout now.', safe: true },
          { id: 'behind', text: 'A logging truck is behind me, going up. Carry on.', safe: false },
          { id: 'other-road', text: 'Nothing. It is on another road.', safe: false },
        ],
        right: '"Down" means its kilometres are decreasing: it is at 3 km and heading toward you. Start looking for a pullout straight away.',
      },
    },
    clearOptions: [
      { id: 'clear', text: '"{clear}"', safe: true },
      { id: 'position', text: '"{position}"', safe: false },
      { id: 'silent', text: 'Say nothing. The truck will see me.', safe: false },
    ],
    rejoinOptions: [
      { id: 'call', text: '"{position}"', safe: true },
      { id: 'silent', text: 'Just pull out. I already called here.', safe: false },
    ],
  },

  // ---- surfaces ---------------------------------------------------------------------------------
  surfaces: {
    sound: { label: 'Firm gravel pullout', short: 'firm' },
    mud: { label: 'Soft, muddy pullout', short: 'mud' },
    rock: { label: 'Loose rock pullout', short: 'rock' },
    none: { label: 'No pullout: still on the road', short: 'none' },
  },

  // ---- debriefs (shown right after the meeting with the truck) -----------------------------------
  debrief: {
    clean: { title: 'Clear', body: 'You were off the road on firm ground before the truck arrived. It went by with room to spare.',
      right: 'This is the whole job: hear the call, pick firm ground early, get right off the road, say you are clear.' },
    stuck: { title: 'Stuck', body: 'The pullout was soft. The truck got past, but your pickup is down to the axles in mud, at night, with the next truck already on its way down.',
      right: 'Mud shines wet and shows deep ruts in your headlights. If the ground looks soft, do not put a wheel on it: use the next firm pullout, or the last one.' },
    damaged: { title: 'Damaged', body: 'The pullout was loose, sharp rock. You are off the road, but a front tire is cut and the truck is sitting on a boulder.',
      right: 'Angular rock throws hard shadows in your headlights. Sharp rock cuts sidewalls and hangs a pickup up. Choose compacted gravel.' },
    nearMiss: { title: 'Near miss', body: 'You were still on the road when the truck came out of the fog. A loaded logging truck can need 90 metres or more to stop. Tonight there was not that much road between you.',
      right: 'Do not wait until the last minute. When you hear a truck coming down, take the first firm pullout you reach and wait there.' },
    late: { title: 'Too close', body: 'You were only part way off the road when the truck arrived. It squeezed by with its horn on.',
      right: 'Be fully off the running surface and stopped before the truck is in sight. Pick the pullout early.' },
  },

  // ---- end screen --------------------------------------------------------------------------------
  summary: {
    title: 'How you did',
    outcomes: { clean: 'Truck cleared safely', stuck: 'Stuck in the mud', damaged: 'Truck damaged on rock', nearMiss: 'Near miss with the logging truck', late: 'Too close for comfort' },
    takeaways: [
      'Pre-trip: walk around, check the radio is on the posted channel, do a radio check.',
      'Call: road name, kilometre, direction. Up means kilometres increasing.',
      'Do not drive by the radio alone. Not everyone has one, and not everyone calls.',
      'Clear early, onto firm ground, fully off the road. Say you are clear. Call again when you rejoin.',
    ],
  },

  // ---- the decision catalogue ---------------------------------------------------------------------
  // Every decision the game reports, with every possible choice and a label for dashboards.
  // `safe` on a choice is the usual value; inspection items depend on whether the item was faulty
  // (see the `detail.fault` field on the event). Keep ids stable: dashboards key on them.
  decisions: [
    { id: 'inspect.lights', group: 'Pre-trip', label: 'Lights checked', choices: { fix: 'Flagged a fault and fixed it', ok: 'Passed it as fine', skipped: 'Skipped the walk-around' } },
    { id: 'inspect.tires', group: 'Pre-trip', label: 'Tires checked', choices: { fix: 'Flagged a fault and fixed it', ok: 'Passed it as fine', skipped: 'Skipped the walk-around' } },
    { id: 'inspect.load', group: 'Pre-trip', label: 'Load secured', choices: { fix: 'Flagged a fault and fixed it', ok: 'Passed it as fine', skipped: 'Skipped the walk-around' } },
    { id: 'inspect.spare', group: 'Pre-trip', label: 'Spare tire checked', choices: { fix: 'Flagged a fault and fixed it', ok: 'Passed it as fine', skipped: 'Skipped the walk-around' } },
    { id: 'inspect.radio', group: 'Pre-trip', label: 'Radio on the posted channel', choices: { fix: 'Switched channel and did a radio check', ok: 'Left it as it was', skipped: 'Skipped the walk-around' } },
    { id: 'call.start', group: 'Radio', label: 'Call when entering the road (0 km)', choices: { correct: 'Correct call', 'wrong-km': 'Called the wrong kilometre', 'wrong-direction': 'Called "down" instead of "up"', 'not-made': 'No call made' } },
    { id: 'heard.other', group: 'Radio', label: 'Heard a call from another road', choices: { 'other-road': 'Recognised it as another road', ahead: 'Thought a truck was coming toward them', behind: 'Thought a truck was behind them', 'no-answer': 'Did not answer' } },
    { id: 'call.mustcall', group: 'Radio', label: 'Call at the MUST CALL sign (1 km)', choices: { correct: 'Correct call', 'wrong-km': 'Called the wrong kilometre', 'wrong-direction': 'Called "down" instead of "up"', 'not-made': 'No call made' } },
    { id: 'heard.truck', group: 'Radio', label: 'Heard the logging truck call "3 kilometre, down"', choices: { ahead: 'Understood it was coming toward them', behind: 'Thought it was behind them', 'other-road': 'Thought it was on another road', 'no-answer': 'Did not answer' } },
    { id: 'call.km2', group: 'Radio', label: 'Call at the 2 km board', choices: { correct: 'Correct call', 'wrong-km': 'Called the wrong kilometre', 'wrong-direction': 'Called "down" instead of "up"', 'not-made': 'No call made' } },
    { id: 'pullout.choice', group: 'Pulling over', label: 'Where they pulled over', choices: { sound: 'Firm gravel pullout', mud: 'Soft, muddy pullout', rock: 'Loose rock pullout', none: 'Did not pull over' } },
    { id: 'pullout.timing', group: 'Pulling over', label: 'Off the road before the truck arrived', choices: { 'in-time': 'Fully off the road in time', late: 'Only part way off', 'on-road': 'Still on the road' } },
    { id: 'call.clear', group: 'Radio', label: 'Called "stopped and in the clear"', choices: { clear: 'Called clear', position: 'Gave a position call instead', silent: 'Said nothing', 'not-applicable': 'Never got clear of the road' } },
    { id: 'call.rejoin', group: 'Radio', label: 'Called again when rejoining the road', choices: { call: 'Called', silent: 'Pulled out without calling' } },
  ],
};
