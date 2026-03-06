import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*                                   Schemas                                  */
/* -------------------------------------------------------------------------- */

const HydrationSchema = z.enum(["clear", "pale", "yellow", "dark", "brown", "unknown"]);

export const PacePilotScoreInputSchema = z.object({
  physio: z
    .object({
      age: z.number().int().min(10).max(99).optional(),
      hrMax: z.number().int().min(100).max(240).optional(),
      hrMaxMeasured: z.boolean().optional(),
      hrRest: z.number().int().min(25).max(120).optional(),
      hrRestBaseline: z.number().int().min(25).max(120).optional(),
      hrThreshold: z.number().int().min(80).max(220).optional(),
      hrThresholdMeasured: z.boolean().optional(),
      vo2max: z.number().min(10).max(95).optional(),
      vo2maxMeasured: z.boolean().optional(),
      ftpWatts: z.number().min(20).max(700).optional(),
      ftpMeasured: z.boolean().optional(),
      weightKg: z.number().min(30).max(250).optional(),
      vmaKmh: z.number().min(5).max(30).optional(),
      vmaMeasured: z.boolean().optional(),
      oneRmSquatKg: z.number().min(10).max(500).optional(),
      oneRmMeasured: z.boolean().optional(),
      hrvBaselineMs: z.number().min(5).max(250).optional(),
    })
    .default({}),

  zones: z
    .object({
      z1: z.boolean().optional(),
      z2: z.boolean().optional(),
      z3: z.boolean().optional(),
      z4: z.boolean().optional(),
      z5: z.boolean().optional(),
      z6: z.boolean().optional(),
      z7: z.boolean().optional(),
      hrDriftPct: z.number().min(0).max(40).optional(),
      runCadenceSpm: z.number().min(100).max(220).optional(),
      paceVariabilitySecPerKm: z.number().min(0).max(180).optional(),
      bikeCadenceRpm: z.number().min(30).max(140).optional(),
      intensityFactor: z.number().min(0.3).max(1.8).optional(),
      targetZoneTimePct: z.number().min(0).max(100).optional(),
    })
    .default({}),

  recovery: z
    .object({
      sleepHours: z.number().min(0).max(14).optional(),
      sleepQuality: z.number().int().min(1).max(5).optional(),
      sleepAwakenings: z.number().int().min(0).max(20).optional(),
      napMinutes: z.number().int().min(0).max(180).optional(),
      hrvMorningMs: z.number().min(5).max(250).optional(),
      fatigue: z.number().int().min(1).max(10).optional(),
      stress: z.number().int().min(1).max(10).optional(),
      pain: z.number().int().min(0).max(10).optional(),
      painZone: z.string().trim().max(80).optional(),
      mood: z.number().int().min(1).max(5).optional(),
      motivation: z.number().int().min(1).max(5).optional(),
      hydration: HydrationSchema.optional(),
      fastingHours: z.number().min(0).max(30).optional(),
      mealHeavyLessThan1h: z.boolean().optional(),
      caloricDeficitChronic: z.boolean().optional(),
    })
    .default({}),

  regularity: z
    .object({
      completionRate4wPct: z.number().min(0).max(100).optional(),
      cancelledStreak: z.number().int().min(0).max(30).optional(),
      noTrainingDays: z.number().int().min(0).max(90).optional(),
      rpeTooHighTrend: z.boolean().optional(),
      rpeTooLowTrend: z.boolean().optional(),
      injuriesPerYear: z.number().int().min(0).max(20).optional(),
      competitionInDays: z.number().int().min(0).max(365).optional(),
      firstCompetition: z.boolean().optional(),
      multisport: z.boolean().optional(),
    })
    .default({}),

  environment: z
    .object({
      tempC: z.number().min(-30).max(55).optional(),
      windKmh: z.number().min(0).max(180).optional(),
      altitudeM: z.number().min(-400).max(9000).optional(),
      rainHeavy: z.boolean().optional(),
      pollutionIqa: z.number().min(0).max(400).optional(),
    })
    .default({}),

  flags: z
    .object({
      chestPain: z.boolean().optional(),
      dyspneaAtRest: z.boolean().optional(),
    })
    .default({}),
});

export type PacePilotScoreInput = z.infer<typeof PacePilotScoreInputSchema>;

export type PacePilotGroup = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7";

export type PacePilotLocks = {
  lockPain: boolean;
  lockAutonomic: boolean;
  lockFatigueSleep: boolean;
  medicalStop: boolean;
};

export type PacePilotScoreResult = {
  total: number;
  group: PacePilotGroup;
  modifiersApplied: number;
  categories: {
    physio: number;
    zones: number;
    recovery: number;
    regularity: number;
  };
  limits: {
    intensityMax: "Z2" | "Z3" | "Z4" | "Z4-Z5" | "Z5" | "Z5-Z6" | "Z6-Z7";
    volumeMaxHours: string;
    frequencyMax: string;
  };
  locks: PacePilotLocks;
  reasons: string[];
};

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function norm(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (max <= min) return 0;
  const v = ((raw - min) / (max - min)) * 10000;
  return clamp(Math.round(v), 0, 10000);
}

function ageExpectedHrMax(age?: number): number | null {
  if (!Number.isFinite(age ?? NaN)) return null;
  return 220 - Math.round(age as number);
}

/* -------------------------------------------------------------------------- */
/*                           Category: PHYSIO (25%)                           */
/* -------------------------------------------------------------------------- */

function scorePhysio(input: PacePilotScoreInput): { raw: number; reasons: string[] } {
  const p = input.physio;
  let s = 0;
  const reasons: string[] = [];

  // 1) HR max
  if (p.hrMaxMeasured) {
    s += 500;
    reasons.push("HRmax measured: +500 reliability");
  } else if (p.hrMax) {
    s += 200;
    reasons.push("HRmax estimated: +200 reliability");
  }

  const expHr = ageExpectedHrMax(p.age);
  if (p.hrMax && expHr) {
    if (p.hrMax >= expHr * 1.1) {
      s += 300;
      reasons.push("HRmax above expected: +300 form");
    } else if (p.hrMax <= expHr * 0.9) {
      s -= 200;
      reasons.push("HRmax below expected: -200 form");
    }
  }

  // 2) Resting HR
  if (p.hrRest) {
    if (p.hrRest < 40) s += 800;
    else if (p.hrRest <= 50) s += 600;
    else if (p.hrRest <= 60) s += 400;
    else if (p.hrRest <= 70) s += 200;
    else if (p.hrRest <= 80) s += 0;
    else s -= 300;
  }

  if (p.hrRest && p.hrRestBaseline) {
    const delta = p.hrRest - p.hrRestBaseline;
    if (delta >= 5) s -= 400;
    else if (delta <= -3) s += 200;
  }

  // 3) HR threshold
  if (p.hrThresholdMeasured) s += 600;
  else if (p.hrThreshold) s += 400;

  if (p.hrThreshold && p.hrMax) {
    const ratio = p.hrThreshold / p.hrMax;
    if (ratio >= 0.85 && ratio <= 0.92) s += 300;
    else if (ratio > 0.92) s += 500;
    else if (ratio < 0.8) s -= 100;
  }

  // 4) VO2max
  if (p.vo2max) {
    if (p.vo2max < 30) s += 100;
    else if (p.vo2max < 40) s += 200;
    else if (p.vo2max < 50) s += 400;
    else if (p.vo2max < 60) s += 600;
    else if (p.vo2max < 70) s += 800;
    else s += 1000;
  }
  if (p.vo2maxMeasured) s += 200;
  else if (p.vo2max) s += 100;

  // 5) FTP
  if (p.ftpMeasured) s += 500;
  else if (p.ftpWatts) s += 300;

  if (p.ftpWatts && p.weightKg) {
    const wkg = p.ftpWatts / p.weightKg;
    if (wkg < 2.0) s += 100;
    else if (wkg < 2.5) s += 300;
    else if (wkg < 3.5) s += 500;
    else if (wkg < 4.5) s += 700;
    else s += 900;
  }

  // 6) VMA
  if (p.vmaKmh) {
    if (p.vmaKmh < 10) s += 100;
    else if (p.vmaKmh < 12) s += 250;
    else if (p.vmaKmh < 14) s += 400;
    else if (p.vmaKmh < 16) s += 600;
    else if (p.vmaKmh < 18) s += 800;
    else if (p.vmaKmh < 20) s += 900;
    else s += 1000;
  }
  if (p.vmaMeasured) s += 200;

  // 7) 1RM squat ratio
  if (p.oneRmMeasured) s += 400;
  if (p.oneRmSquatKg && p.weightKg) {
    const ratio = p.oneRmSquatKg / p.weightKg;
    if (ratio < 0.75) s += 100;
    else if (ratio < 1.25) s += 300;
    else if (ratio < 1.75) s += 500;
    else s += 700;
  }

  // 8) HRV baseline
  if (p.hrvBaselineMs) {
    if (p.hrvBaselineMs < 20) s += 100;
    else if (p.hrvBaselineMs < 40) s += 300;
    else if (p.hrvBaselineMs < 60) s += 500;
    else if (p.hrvBaselineMs < 80) s += 700;
    else s += 900;
  }

  return { raw: s, reasons };
}

/* -------------------------------------------------------------------------- */
/*                           Category: ZONES (30%)                            */
/* -------------------------------------------------------------------------- */

function scoreZones(input: PacePilotScoreInput): { raw: number; reasons: string[] } {
  const z = input.zones;
  let s = 0;
  const reasons: string[] = [];

  const zoneRules: Array<[keyof typeof z, number, number, string]> = [
    ["z1", 200, -50, "Z1 mastery"],
    ["z2", 400, -150, "Z2 mastery"],
    ["z3", 500, -200, "Z3 mastery"],
    ["z4", 700, -300, "Z4 mastery"],
    ["z5", 800, -400, "Z5 mastery"],
    ["z6", 600, -200, "Z6 mastery"],
    ["z7", 500, -100, "Z7 mastery"],
  ];

  for (const [k, yes, no, label] of zoneRules) {
    if (z[k] === true) {
      s += yes;
      reasons.push(`${label}: +${yes}`);
    } else if (z[k] === false) {
      s += no;
      reasons.push(`${label}: ${no}`);
    }
  }

  if (Number.isFinite(z.hrDriftPct ?? NaN)) {
    const d = z.hrDriftPct as number;
    if (d < 3) s += 600;
    else if (d < 5) s += 400;
    else if (d < 8) s += 200;
    else if (d < 12) s -= 100;
    else s -= 300;
  }

  if (Number.isFinite(z.runCadenceSpm ?? NaN)) {
    s += z.runCadenceSpm! >= 170 && z.runCadenceSpm! <= 180 ? 300 : -100;
  }

  if (Number.isFinite(z.paceVariabilitySecPerKm ?? NaN)) {
    s += z.paceVariabilitySecPerKm! <= 5 ? 200 : -100;
  }

  if (Number.isFinite(z.bikeCadenceRpm ?? NaN)) {
    s += z.bikeCadenceRpm! >= 85 && z.bikeCadenceRpm! <= 100 ? 300 : -100;
  }

  if (Number.isFinite(z.intensityFactor ?? NaN)) {
    s += z.intensityFactor! < 1.05 ? 200 : -200;
  }

  if (Number.isFinite(z.targetZoneTimePct ?? NaN)) {
    s += z.targetZoneTimePct! >= 80 ? 400 : -200;
  }

  return { raw: s, reasons };
}

/* -------------------------------------------------------------------------- */
/*                          Category: RECOVERY (25%)                          */
/* -------------------------------------------------------------------------- */

function scoreRecovery(input: PacePilotScoreInput): { raw: number; reasons: string[] } {
  const r = input.recovery;
  const p = input.physio;
  let s = 0;
  const reasons: string[] = [];

  // Sleep quality block
  if (Number.isFinite(r.sleepHours ?? NaN) && Number.isFinite(r.sleepQuality ?? NaN)) {
    const h = r.sleepHours!;
    const q = r.sleepQuality!;
    if (h > 8 && q >= 5) s += 500;
    else if (h >= 7 && q >= 4) s += 350;
    else if (h >= 6 && q >= 3) s += 200;
    else if (h >= 5 && q >= 2) s -= 200;
    else s -= 500;

    if (h < 4) s -= 800;
  }

  if (Number.isFinite(r.sleepAwakenings ?? NaN) && r.sleepAwakenings! > 3) s -= 300;
  if (Number.isFinite(r.napMinutes ?? NaN) && r.napMinutes! >= 20 && r.napMinutes! <= 30) s += 150;

  // HRV morning vs baseline
  if (Number.isFinite(r.hrvMorningMs ?? NaN) && Number.isFinite(p.hrvBaselineMs ?? NaN) && p.hrvBaselineMs! > 0) {
    const deltaPct = ((r.hrvMorningMs! - p.hrvBaselineMs!) / p.hrvBaselineMs!) * 100;
    if (deltaPct > 10) s += 600;
    else if (deltaPct >= -5) s += 400;
    else if (deltaPct >= -10) s += 100;
    else if (deltaPct >= -20) s -= 300;
    else if (deltaPct >= -30) s -= 600;
    else s -= 900;
  }

  // Fatigue
  if (Number.isFinite(r.fatigue ?? NaN)) {
    const f = r.fatigue!;
    if (f <= 2) s += 400;
    else if (f <= 4) s += 300;
    else if (f <= 6) s += 100;
    else if (f === 7) s -= 200;
    else if (f === 8) s -= 400;
    else s -= 700;
  }

  // Stress
  if (Number.isFinite(r.stress ?? NaN)) {
    const st = r.stress!;
    if (st <= 2) s += 300;
    else if (st <= 4) s += 200;
    else if (st <= 6) s += 0;
    else if (st <= 8) s -= 300;
    else s -= 600;
  }

  // Pain
  if (Number.isFinite(r.pain ?? NaN)) {
    const pain = r.pain!;
    if (pain <= 2) s += pain === 0 ? 200 : 0;
    else if (pain <= 4) s -= 200;
    else if (pain <= 6) s -= 400;
    else if (pain <= 8) s -= 700;
    else s -= 1000;

    const zone = String(r.painZone ?? "").toLowerCase();
    if (zone.includes("genou") || zone.includes("knee")) s -= 300;
    if (zone.includes("cheville") || zone.includes("ankle")) s -= 300;
    if (zone.includes("epaule") || zone.includes("shoulder")) s -= 300;
    if (zone.includes("lomb") || zone.includes("dos") || zone.includes("back")) s -= 400;
  }

  // Mood + motivation
  const mood = Number(r.mood ?? NaN);
  const motivation = Number(r.motivation ?? NaN);
  if (Number.isFinite(mood)) {
    if (mood >= 5) s += 400;
    else if (mood >= 4) s += 250;
    else if (mood >= 3) s += 100;
    else if (mood >= 2) s -= 150;
    else s -= 300;
  }
  if (Number.isFinite(motivation) && Number.isFinite(r.fatigue ?? NaN)) {
    if (motivation + (r.fatigue as number) < 3) s -= 500;
  }

  // Hydration
  switch (r.hydration) {
    case "clear":
      s += 100;
      break;
    case "pale":
      s += 300;
      break;
    case "yellow":
      s += 100;
      break;
    case "dark":
      s -= 200;
      break;
    case "brown":
      s -= 500;
      break;
    default:
      break;
  }

  // Nutrition pre-session
  if (Number.isFinite(r.fastingHours ?? NaN)) {
    const fh = r.fastingHours!;
    if (fh <= 1) s += 200;
    else if (fh < 12) s += 100;
    else s -= 200;
  }
  if (r.mealHeavyLessThan1h) s -= 300;
  if (r.caloricDeficitChronic) s -= 400;

  if (Number.isFinite(r.stress ?? NaN) && Number.isFinite(r.fatigue ?? NaN) && r.stress! + r.fatigue! > 14) {
    s -= 800;
  }

  return { raw: s, reasons };
}

/* -------------------------------------------------------------------------- */
/*                         Category: REGULARITY (20%)                         */
/* -------------------------------------------------------------------------- */

function scoreRegularity(input: PacePilotScoreInput): { raw: number; reasons: string[] } {
  const r = input.regularity;
  let s = 0;
  const reasons: string[] = [];

  if (Number.isFinite(r.completionRate4wPct ?? NaN)) {
    const c = r.completionRate4wPct!;
    if (c >= 80) s += 600;
    else if (c >= 60) s += 250;
    else if (c >= 40) s += 50;
    else s -= 200;
  }

  if (Number.isFinite(r.noTrainingDays ?? NaN) && r.noTrainingDays! > 14) s -= 400;
  if (r.rpeTooHighTrend) s -= 300;
  if (r.rpeTooLowTrend) s -= 200;
  if (Number.isFinite(r.competitionInDays ?? NaN) && r.competitionInDays! < 28) s += 200;
  if (r.firstCompetition) s += 100;
  if (Number.isFinite(r.injuriesPerYear ?? NaN) && r.injuriesPerYear! > 2) s -= 300;
  if (r.multisport) s += 150;

  if (Number.isFinite(r.cancelledStreak ?? NaN) && r.cancelledStreak! >= 3) s -= 300;

  return { raw: s, reasons };
}

/* -------------------------------------------------------------------------- */
/*                          Environment: multipliers                          */
/* -------------------------------------------------------------------------- */

function computeEnvMultiplier(input: PacePilotScoreInput): { mult: number; reasons: string[] } {
  const e = input.environment;
  let mult = 1;
  const reasons: string[] = [];

  if (Number.isFinite(e.tempC ?? NaN)) {
    const t = e.tempC as number;
    if (t > 32) {
      mult *= 0.85;
      reasons.push("Heat >32C: x0.85");
    } else if (t > 28 || t < 5) {
      mult *= 0.92;
      reasons.push("Non optimal temperature: x0.92");
    } else if (t >= 5 && t <= 20) {
      mult *= 1.05;
      reasons.push("Ideal temperature: x1.05");
    }
  }

  if (Number.isFinite(e.altitudeM ?? NaN) && (e.altitudeM as number) > 1500) {
    mult *= 0.9;
    reasons.push("Altitude >1500m: x0.90");
  }

  if (Number.isFinite(e.windKmh ?? NaN) && (e.windKmh as number) > 30) {
    mult *= 0.95;
    reasons.push("Strong wind: x0.95");
  }

  if (e.rainHeavy) {
    mult *= 0.95;
    reasons.push("Heavy rain: x0.95");
  }

  if (Number.isFinite(e.pollutionIqa ?? NaN) && (e.pollutionIqa as number) > 100) {
    mult *= 0.9;
    reasons.push("Air pollution >100: x0.90");
  }

  return { mult: clamp(mult, 0.65, 1.1), reasons };
}

/* -------------------------------------------------------------------------- */
/*                                  Locks                                     */
/* -------------------------------------------------------------------------- */

function computeLocks(input: PacePilotScoreInput): PacePilotLocks {
  const r = input.recovery;
  const p = input.physio;

  const lockPain = Number(r.pain ?? 0) > 5;

  const hrvDropPct =
    Number.isFinite(r.hrvMorningMs ?? NaN) && Number.isFinite(p.hrvBaselineMs ?? NaN) && p.hrvBaselineMs! > 0
      ? ((r.hrvMorningMs! - p.hrvBaselineMs!) / p.hrvBaselineMs!) * 100
      : 0;

  const hrRestDelta =
    Number.isFinite(p.hrRest ?? NaN) && Number.isFinite(p.hrRestBaseline ?? NaN)
      ? p.hrRest! - p.hrRestBaseline!
      : 0;

  const lockAutonomic = hrvDropPct <= -20 || hrRestDelta >= 8;

  const lockFatigueSleep = Number(r.fatigue ?? 0) > 8 && Number(r.sleepHours ?? 24) < 5;

  const medicalStop = Boolean(input.flags.chestPain) || Boolean(input.flags.dyspneaAtRest);

  return { lockPain, lockAutonomic, lockFatigueSleep, medicalStop };
}

/* -------------------------------------------------------------------------- */
/*                             Group + limits map                             */
/* -------------------------------------------------------------------------- */

function groupFromScore(total: number): PacePilotGroup {
  if (total < 1500) return "G1";
  if (total < 3000) return "G2";
  if (total < 5000) return "G3";
  if (total < 6500) return "G4";
  if (total < 8000) return "G5";
  if (total < 9000) return "G6";
  return "G7";
}

function limitsFromGroup(group: PacePilotGroup): PacePilotScoreResult["limits"] {
  switch (group) {
    case "G1":
      return { intensityMax: "Z2", volumeMaxHours: "2-3h", frequencyMax: "3 sessions" };
    case "G2":
      return { intensityMax: "Z3", volumeMaxHours: "3-5h", frequencyMax: "3-4 sessions" };
    case "G3":
      return { intensityMax: "Z4", volumeMaxHours: "5-7h", frequencyMax: "4-5 sessions" };
    case "G4":
      return { intensityMax: "Z4-Z5", volumeMaxHours: "7-9h", frequencyMax: "5 sessions" };
    case "G5":
      return { intensityMax: "Z5", volumeMaxHours: "9-12h", frequencyMax: "5-6 sessions" };
    case "G6":
      return { intensityMax: "Z5-Z6", volumeMaxHours: "12-15h", frequencyMax: "6 sessions" };
    case "G7":
      return { intensityMax: "Z6-Z7", volumeMaxHours: "15h+", frequencyMax: "6-7 sessions" };
  }
}

/* -------------------------------------------------------------------------- */
/*                                     API                                    */
/* -------------------------------------------------------------------------- */

export function computePacePilotScore(inputRaw: PacePilotScoreInput): PacePilotScoreResult {
  const input = PacePilotScoreInputSchema.parse(inputRaw);

  const phy = scorePhysio(input);
  const zon = scoreZones(input);
  const rec = scoreRecovery(input);
  const reg = scoreRegularity(input);

  const physio = norm(phy.raw, -2000, 7000);
  const zones = norm(zon.raw, -2500, 7000);
  const recovery = norm(rec.raw, -4000, 5000);
  const regularity = norm(reg.raw, -1500, 2500);

  const weighted = physio * 0.25 + zones * 0.3 + recovery * 0.25 + regularity * 0.2;

  const env = computeEnvMultiplier(input);
  const total = clamp(Math.round(weighted * env.mult), 0, 10000);

  const locks = computeLocks(input);

  const hardLock = locks.lockPain || locks.lockAutonomic || locks.lockFatigueSleep || locks.medicalStop;
  const group = hardLock ? "G1" : groupFromScore(total);

  const reasons = [
    ...phy.reasons,
    ...zon.reasons,
    ...rec.reasons,
    ...reg.reasons,
    ...env.reasons,
  ].slice(0, 14);

  if (locks.lockPain) reasons.unshift("Safety lock: pain > 5/10");
  if (locks.lockAutonomic) reasons.unshift("Safety lock: HRV drop <= -20% or resting HR +8 bpm");
  if (locks.lockFatigueSleep) reasons.unshift("Safety lock: fatigue > 8 and sleep < 5h");
  if (locks.medicalStop) reasons.unshift("Medical stop: chest pain or dyspnea at rest");

  return {
    total,
    group,
    modifiersApplied: env.mult,
    categories: { physio, zones, recovery, regularity },
    limits: limitsFromGroup(group),
    locks,
    reasons,
  };
}

export function buildScoreInputFromAvatar(args: {
  profile?: Record<string, unknown> | null;
  recovery?: Record<string, unknown> | null;
  regularity?: Record<string, unknown> | null;
  environment?: Record<string, unknown> | null;
}): PacePilotScoreInput {
  const profile = (args.profile ?? {}) as any;
  const recovery = (args.recovery ?? {}) as any;
  const regularity = (args.regularity ?? {}) as any;
  const environment = (args.environment ?? {}) as any;

  const sports = Array.isArray(profile?.sports) ? profile.sports.map((x: unknown) => String(x).toLowerCase()) : [];
  const isBike = sports.some((s: string) => s.includes("velo") || s.includes("vtt") || s.includes("bike"));

  return {
    physio: {
      age: Number(profile?.age),
      hrMax: Number(profile?.physiology?.hrMax),
      hrMaxMeasured: Boolean(profile?.physiology?.hrMaxMeasured),
      hrRest: Number(profile?.physiology?.hrRest),
      hrRestBaseline: Number(profile?.physiology?.hrRestBaseline),
      hrThreshold: Number(profile?.physiology?.hrThreshold),
      hrThresholdMeasured: Boolean(profile?.physiology?.hrThresholdMeasured),
      vo2max: Number(profile?.physiology?.vo2max),
      vo2maxMeasured: Boolean(profile?.physiology?.vo2maxMeasured),
      ftpWatts: isBike ? Number(profile?.physiology?.ftpWatts) : undefined,
      ftpMeasured: Boolean(profile?.physiology?.ftpMeasured),
      weightKg: Number(profile?.weightKg),
      vmaKmh: Number(profile?.physiology?.vmaKmh),
      vmaMeasured: Boolean(profile?.physiology?.vmaMeasured),
      oneRmSquatKg: Number(profile?.physiology?.oneRmSquatKg),
      oneRmMeasured: Boolean(profile?.physiology?.oneRmMeasured),
      hrvBaselineMs: Number(profile?.physiology?.hrvBaselineMs),
    },
    zones: {
      targetZoneTimePct: Number(profile?.physiology?.targetZoneTimePct),
      runCadenceSpm: Number(profile?.physiology?.runCadenceSpm),
      bikeCadenceRpm: Number(profile?.physiology?.bikeCadenceRpm),
      hrDriftPct: Number(profile?.physiology?.hrDriftPct),
      intensityFactor: Number(profile?.physiology?.intensityFactor),
    },
    recovery: {
      sleepHours: Number(recovery?.sleepHours),
      sleepQuality: Number(recovery?.sleepQuality),
      hrvMorningMs: Number(recovery?.hrvMorningMs),
      fatigue: Number(recovery?.fatigue),
      stress: Number(recovery?.stress),
      pain: Number(recovery?.pain),
      painZone: typeof recovery?.painZone === "string" ? recovery.painZone : undefined,
      mood: Number(recovery?.mood),
      motivation: Number(recovery?.motivation),
      hydration: recovery?.hydration,
      fastingHours: Number(recovery?.fastingHours),
      mealHeavyLessThan1h: Boolean(recovery?.mealHeavyLessThan1h),
      caloricDeficitChronic: Boolean(recovery?.caloricDeficitChronic),
    },
    regularity: {
      completionRate4wPct: Number(regularity?.completionRate4wPct),
      noTrainingDays: Number(regularity?.noTrainingDays),
      cancelledStreak: Number(regularity?.cancelledStreak),
      injuriesPerYear: Number(regularity?.injuriesPerYear),
      competitionInDays: Number(regularity?.competitionInDays),
      firstCompetition: Boolean(regularity?.firstCompetition),
      multisport: Array.isArray(profile?.sports) && profile.sports.length > 1,
    },
    environment: {
      tempC: Number(environment?.tempC),
      windKmh: Number(environment?.windKmh),
      altitudeM: Number(environment?.altitudeM),
      rainHeavy: Boolean(environment?.rainHeavy),
      pollutionIqa: Number(environment?.pollutionIqa),
    },
    flags: {
      chestPain: Boolean(recovery?.chestPain),
      dyspneaAtRest: Boolean(recovery?.dyspneaAtRest),
    },
  };
}
