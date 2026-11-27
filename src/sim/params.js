// All rates and behavior constants are game calibration assumptions unless a source is named.
export const CLOCK = Object.freeze({
  step: 0.25, // source: GAME_SPEC.md fixed simulation step (seconds)
  speeds: [0, 1, 2, 4, 8], // source: GAME_SPEC.md pause and playback speeds
  window: 300, // source: GAME_SPEC.md metrics window (seconds)
  levelDuration: 600, // Fixed benchmark duration (seconds). Interactive runs have no cutoff.
});

export const NETWORK = Object.freeze({
  stopSetback: { north: 24, south: 31, east: 37, west: 13 }, // assumed metres from each incoming OSM carriageway endpoint
  exitSetback: { north: 25, south: 40, east: 29, west: 13 }, // assumed metres from each outgoing OSM carriageway endpoint
  usableWidth: 3.3, // assumed maximum lane width for lane centering (metres)
  leftHandTraffic: true, // source: GAME_SPEC.md
  filterWidth: 0.9, // assumed width needed for a motorcycle between lane centres (metres)
  curbOffset: 0.9, // assumed setback of the boarding marker from the carriageway edge (metres)
  bayOffset: 3.2, // assumed lateral displacement of a bus in a bay (metres)
  curveResolution: 14, // assumed subdivisions per junction polyline
  sharedLaneClearance: 1.1, // assumed clearance between paths diverging from the same lane (metres)
  clearance: 2.1, // assumed junction path clearance for conflicting vehicle envelopes (metres)
});

export const DRIVER = Object.freeze({
  headway: 0.85, // assumed clear time gap (s); vehicle length, standstill gap and start-up add to stop-line headway
  exponent: 4, // source: canonical Intelligent Driver Model acceleration exponent
  hardBrake: 8, // assumed emergency deceleration cap (m/s²)
  turnSpeed: { left: 6, through: 10, right: 7 }, // assumed m/s in dry conditions
  stoppedSpeed: 0.4, // assumed queue and idle speed threshold (m/s)
  laneChangeSpeed: 0.85, // assumed lateral transition (fraction per second)
  priorityGap: 4, // assumed seconds needed for the minor approach to accept a gap
  crossingTimeMargin: 0.8, // assumed additional seconds between different approaches at a connector conflict
  divergeTimeMargin: 0.12, // assumed extra seconds after the preceding rear clears a shared entry
  laneChangeGain: 1.8, // assumed minimum extra metres of headway sought when changing lanes
  laneChangeLookahead: 29, // assumed lane-change lookahead (metres)
  filterApproach: 52, // assumed maximum stacking distance from the stop line (metres)
  filterMaxSpeed: 4, // assumed motorcycle filtering speed (m/s)
  filterStartSpeed: 3, // assumed leader speed below which filtering starts (m/s)
  minimumGap: 0.18, // assumed hard longitudinal safety margin (metres)
});

export const SATURATION = Object.freeze({
  basePcuPerGreenLaneHour: 1800, // assumed dry, continuously queued car-equivalent reference (~2 s per PCU)
  motorcyclePcu: 0.4, // assumed within 0.25–0.5 PCU; bike length and the parallel filter stream also reduce space use
});

export const VEHICLES = Object.freeze({
  // assumed per type: share, length (m), speed (m/s), acceleration and braking (m/s²),
  // standstill gap (m), lane discipline (0–1), persons, idle grams of CO₂ per second
  motorcycle: { share: 0.70, length: 1.9, speed: 13, acceleration: 2.6, braking: 2.2, gap: 0.65, discipline: 0.29, occupancy: 1.25, idleGrams: 0.30 },
  car: { share: 0.11, length: 4, speed: 12, acceleration: 1.9, braking: 2, gap: 1.1, discipline: 0.8, occupancy: 1.8, idleGrams: 0.65 },
  taxi: { share: 0.04, length: 4, speed: 12, acceleration: 1.8, braking: 2, gap: 1, discipline: 0.70, occupancy: 2.4, idleGrams: 0.65 },
  microbus: { share: 0.065, length: 5.2, speed: 10.5, acceleration: 1.45, braking: 1.8, gap: 1.1, discipline: 0.55, occupancy: 12, idleGrams: 1.05, transit: true, baseDwell: 7, boardingTime: 1.8, boarders: 7, plateCode: 'Kha' },
  tempo: { share: 0.015, length: 3.1, speed: 8.5, acceleration: 1.4, braking: 1.8, gap: 0.85, discipline: 0.53, occupancy: 7, idleGrams: 0, transit: true, baseDwell: 5, boardingTime: 1.6, boarders: 5, plateCode: 'Ha' },
  sajha: { share: 0.015, length: 11, speed: 10, acceleration: 1.1, braking: 1.55, gap: 1.35, discipline: 0.81, occupancy: 32, idleGrams: 0, transit: true, baseDwell: 12, boardingTime: 2.0, boarders: 12, plateCode: 'Kha' },
  bus: { share: 0.025, length: 9, speed: 10, acceleration: 1.1, braking: 1.55, gap: 1.3, discipline: 0.68, occupancy: 27, idleGrams: 1.9, transit: true, baseDwell: 11, boardingTime: 2.1, boarders: 11, plateCode: 'Kha' },
  truck: { share: 0.03, length: 6.5, speed: 9.5, acceleration: 1.05, braking: 1.6, gap: 1.35, discipline: 0.85, occupancy: 2, idleGrams: 1.75, plateCode: 'Kha' },
});
export const PLATES = Object.freeze({
  zones: ['Ba', 'Ba', 'Ba', 'Bagmati'], // assumed Bagmati-style format
  zoneSeries: 25, // assumed span of traditional registration series
  modernSeries: '03-001', // assumed province-style format
  serials: 9999, // assumed range of four-digit serials
});

export const TRANSIT = Object.freeze({
  junctionInfluence: 35, // assumed proximity in metres to a stop line or exit entrance for junction curb-blocked seconds
  informalRange: [6, 22], // assumed stop-line distances (metres) for informal stopping
  fallbackDistance: 20, // assumed distance upstream past a no-stopping zone to look for a curb
  stopTolerance: 0.25, // assumed boarding position tolerance (metres)
  mergeSpeed: 2, // assumed speed after rejoining traffic from a bay (m/s)
  stopLineClearance: 2, // assumed minimum front-bumper distance from the line for boarding
});

export const SIGNAL = Object.freeze({
  cycle: 62, // assumed game cycle length (seconds) for the three main approaches
  splits: { north: 0.34, south: 0.32, east: 0.34 }, // assumed approach green fractions
  amber: 3, // assumed amber clearance (seconds)
  allRed: 2, // assumed all-red clearance (seconds)
  minGreen: 5, // assumed minimum green (seconds)
  manualFactor: 1.18, // assumed police-controlled green extension
  manualVariation: 0.32, // assumed fractional variability of police-controlled phases
  manualQueueGain: 0.012, // assumed green adjustment per queued vehicle for manual control
  manualMaxQueueGain: 0.25, // assumed cap on green adjustment
  cycleLimits: [52, 220], // assumed limits on adjustable cycle length (seconds)
});

export const PED = Object.freeze({
  crossingSpeed: 1.18, // assumed m/s
  patience: 22, // assumed earliest unsafe-crossing decision (seconds)
  patienceSpread: 33, // assumed spread of individual patience (seconds)
  impatienceRate: 0.16, // assumed per-second unsafe crossing hazard once patient wait expires
  safeGap: 5, // assumed minimum gap (seconds) on an unsignalised crossing
  zebraYield: 0.87, // assumed probability of a driver yielding at a zebra
  maxYieldWait: 3.5, // assumed time (seconds) before a zebra pedestrian attempts to assert priority
  crosswalkGap: 3, // assumed longitudinal stop margin at a crosswalk (metres)
  minimumWidth: 6, // assumed minimum crossing length (metres)
});

export const TOOLS = Object.freeze({
  // assumed game prices in NPR, build times in seconds and behavior effects
  moveStop: { cost: 18000, buildTime: 0, minDistance: 5, maxDistance: 160 },
  noStoppingZone: { cost: 22000, buildTime: 0, minLength: 10, maxLength: 60, compliance: 0.64 }, // assumed compliance

  busBay: { cost: 145000, buildTime: 20, halfLength: 12 },
  signalTiming: { cost: 12000, buildTime: 0 },
  policeOfficer: { cost: 8500, buildTime: 0, perMinute: 110, compliance: 0.56, radius: 55 }, // assumed compliance

  zebra: { cost: 27000, buildTime: 0 },
  pedestrianSignal: { cost: 52000, buildTime: 10 },
  freeLeft: { cost: 42000, buildTime: 12 },
  infoCampaign: { cost: 6500, buildTime: 0, compliance: 0.22 }, // assumed compliance
  // Short-term package (assumed effects; costs illustrative)
  adaptiveSignals: { cost: 4500000, buildTime: 0, minGreen: 8, maxFactor: 1.6, base: 0.9, perVehicle: 0.02 }, // assumed queue-responsive greens
  laneDiscipline: { cost: 1200000, buildTime: 0, mergeZone: 40 }, // assumed: no lane changes in the last 40 m (merges happen upstream)
  guardrails: { cost: 2500000, buildTime: 0 }, // assumed: pedestrians only cross at marked crossings
  // Long-term package (JICA Tinkune-Koteshwor-Jadibuti corridor concept; costs illustrative)
  gradeSeparation: { cost: 9000000000, buildTime: 0, corridor: [['north', 'through'], ['east', 'through']] }, // assumed: corridor through traffic bypasses the surface junction
  pedestrianUnderpass: { cost: 350000000, buildTime: 0 }, // assumed: pedestrians cross below grade, no surface conflicts
  pedestrianSkybridge: { cost: 350000000, buildTime: 0 }, // illustrative cost, no surface conflicts
});

export const DEMAND = Object.freeze({
  // assumed supplied rates are vehicles/hour by approach in north, south, east, west order.
  // assumed pedestrian rates are people/hour, same approach order.
  morning: { rates: [1340, 1270, 1560, 0], pedestrians: [310, 180, 210, 0], speed: 1, dwell: 1, informal: 0.47, stopShare: [0.63, 0.3, 0.38, 0], budget: 160000 },
  busBunching: { rates: [1490, 950, 1180, 0], pedestrians: [360, 160, 155, 0], speed: 0.95, dwell: 1.36, informal: 0.67, stopShare: [1, 0.09, 0.11, 0], budget: 185000, transitMultiplier: [2.4, 1, 1, 1] },
  rain: { rates: [1510, 1350, 1590, 0], pedestrians: [265, 170, 205, 0], speed: 0.72, dwell: 1.46, informal: 0.59, stopShare: [0.69, 0.35, 0.41, 0], budget: 205000 },
  dashain: { rates: [1770, 1470, 1050, 0], pedestrians: [325, 185, 255, 0], speed: 0.91, dwell: 1.16, informal: 0.49, stopShare: [0.67, 0.31, 0.30, 0], budget: 230000, eastbound: [0.66, 0.68, 0, 0] },
  sandbox: { rates: [380, 330, 440, 0], pedestrians: [115, 80, 95, 0], speed: 1, dwell: 1, informal: 0.43, stopShare: [0.59, 0.26, 0.34, 0], budget: Infinity },
  defaultTurns: { north: [0, 0.55, 0.45], south: [0.025, 0.61, 0.365], east: [0.40, 0.60, 0], west: [1, 0, 0] }, // assumed left/through/right shares
});
