// src/services/trainingPlan/generatePlan.ts
import type { Program, Profile } from "@/src/domain/onboarding.schema";
import type { TrainingPlan, TrainingWeek, TrainingSession, SessionKind, SessionTarget } from "@/src/domain/trainingPlan.types";

/* --------------------------------- dates (local safe) --------------------------------- */

function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local date (midday to avoid DST edge cases) */
function parseLocalISODate(iso: string): Date {
  const [y, m, d] = String(iso).split("-").map((x) => Number(x));
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

/** Add days to YYYY-MM-DD (local), return YYYY-MM-DD */
function addDaysISO(iso: string, days: number): string {
  const dt = parseLocalISODate(iso);
  dt.setDate(dt.getDate() + days);
  return localISODate(dt);
}

/** Monday ISO (YYYY-MM-DD) in local time */
function getMondayISO(d: Date): string {
  const dt = new Date(d.getTime());
  const js = dt.getDay(); // 0=Sun..6=Sat
  const mon0 = js === 0 ? 6 : js - 1; // 0=Mon..6=Sun
  dt.setDate(dt.getDate() - mon0);
  dt.setHours(12, 0, 0, 0);
  return localISODate(dt);
}

/* --------------------------------- basic helpers --------------------------------- */

function isoNow(): string {
  return new Date().toISOString();
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(x)));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function uniqSortedDays(days: unknown): number[] {
  const raw = Array.isArray(days) ? days : [];
  return Array.from(
    new Set(
      raw
        .map((d) => (typeof d === "number" ? d : Number(d)))
        .filter((d) => Number.isFinite(d))
        .map((d) => Math.trunc(d))
        .filter((d) => d >= 0 && d <= 6)
    )
  ).sort((a, b) => a - b);
}

/**
 * Répartit "total" en parts entières (km/min), somme garantie.
 * Ex: splitInt(10,[0.3,0.7]) -> [3,7]
 */
function splitInt(total: number, weights: number[]): number[] {
  const safeTotal = Math.max(0, Math.trunc(total));
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sumW = w.reduce((a, b) => a + b, 0);

  if (safeTotal === 0) return weights.map(() => 0);
  if (sumW === 0) return weights.map(() => 0);

  const raw = w.map((x) => (safeTotal * x) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let rest = safeTotal - floors.reduce((a, b) => a + b, 0);

  const fracOrder = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  for (let k = 0; k < fracOrder.length && rest > 0; k++) {
    out[fracOrder[k].i] += 1;
    rest -= 1;
    if (k === fracOrder.length - 1 && rest > 0) k = -1;
  }
  return out;
}

/* --------------------------------- plan sizing --------------------------------- */

function goalWeeks(goal: Program["goal"]): number {
  switch (goal) {
    case "Marathon":
      return 12;
    case "Semi-marathon":
      return 10;
    case "10 km":
      return 8;
    default:
      return 6;
  }
}

function baseWeeklyKm(level: Program["level"]): number {
  switch (level) {
    case "Débutant":
      return 18;
    case "Intermédiaire":
      return 28;
    default:
      return 40;
  }
}

type Focus = "Base" | "Spécifique" | "Taper";

function weekFocus(weekIndex1: number, weeksCount: number): Focus {
  const taperWeeks = Math.max(2, Math.round(weeksCount * 0.18));
  const baseWeeks = Math.max(3, Math.round(weeksCount * 0.35));

  if (weekIndex1 > weeksCount - taperWeeks) return "Taper";
  if (weekIndex1 <= baseWeeks) return "Base";
  return "Spécifique";
}

function weekTotalKm(baseKm: number, weekIndex1: number, weeksCount: number, focus: Focus): number {
  // montée douce + deload toutes les 4 semaines
  const isDeload = weekIndex1 % 4 === 0;
  const growth = 1 + (weekIndex1 - 1) * 0.05;

  let km = baseKm * (isDeload ? growth * 0.82 : growth);

  // taper: baisse progressive sur les dernières semaines
  if (focus === "Taper") {
    const weeksLeft = weeksCount - weekIndex1; // 0..taper-1
    const taperFactor = weeksLeft <= 0 ? 0.55 : weeksLeft === 1 ? 0.7 : 0.8;
    km *= taperFactor;
  }

  return Math.max(0, Math.round(km));
}

/* --------------------------------- days selection --------------------------------- */

/**
 * Jours par défaut (0..6 = Lun..Dim)
 * Objectif : espacer les séances, SL en fin de semaine.
 */
function defaultTrainingDays(sessionsPerWeek: number): number[] {
  const map: Record<number, number[]> = {
    1: [6], // Dim
    2: [2, 6], // Mer / Dim
    3: [1, 3, 6], // Mar / Jeu / Dim
    4: [1, 3, 5, 6], // Mar / Jeu / Sam / Dim
    5: [0, 1, 3, 5, 6], // Lun / Mar / Jeu / Sam / Dim
    6: [0, 1, 2, 3, 5, 6], // Lun..Jeu + Sam + Dim
  };
  return map[sessionsPerWeek] ?? map[3];
}

function buildTrainingDays(sessionsPerWeek: number, trainingDays?: unknown): number[] {
  const wanted = uniqSortedDays(trainingDays);
  const defaults = defaultTrainingDays(sessionsPerWeek);

  const out: number[] = [];

  for (const d of wanted) {
    if (out.length >= sessionsPerWeek) break;
    if (!out.includes(d)) out.push(d);
  }
  for (const d of defaults) {
    if (out.length >= sessionsPerWeek) break;
    if (!out.includes(d)) out.push(d);
  }
  for (let d = 0; d <= 6 && out.length < sessionsPerWeek; d++) {
    if (!out.includes(d)) out.push(d);
  }

  return out.slice(0, sessionsPerWeek).sort((a, b) => a - b);
}

/* --------------------------------- session mapping --------------------------------- */

type WorkoutKey = "EF" | "QUALITE" | "SL";

function sessionKindFor(workout: WorkoutKey): SessionKind {
  if (workout === "EF" || workout === "QUALITE" || workout === "SL") return "run";
  return "run";
}

function targetFor(workout: WorkoutKey, goal: Program["goal"]): SessionTarget | undefined {
  if (workout === "EF" || workout === "SL") {
    return { label: "Z2 / EF", rpe: 3 };
  }

  // QUALITE
  if (goal === "10 km") return { label: "Seuil / Intervalles", rpe: 7 };
  if (goal === "Semi-marathon") return { label: "Allure semi / tempo", rpe: 7 };
  if (goal === "Marathon") return { label: "Tempo contrôlé", rpe: 6 };
  return { label: "Soutenu", rpe: 6 };
}

function titleFor(workout: WorkoutKey): string {
  if (workout === "EF") return "EF";
  if (workout === "SL") return "SL";
  return "Qualité";
}

function descriptionFor(workout: WorkoutKey, goal: Program["goal"], focus: Focus): string | undefined {
  if (workout === "EF") {
    return focus === "Taper" ? "Très facile, relâché." : "Souple, conversationnel.";
  }
  if (workout === "SL") {
    return focus === "Taper" ? "Sortie longue allégée, reste frais." : "Allure facile, régulière.";
  }

  // QUALITE
  if (goal === "10 km") return focus === "Taper" ? "Rappel léger : 6×1' vite / 1' lent." : "Ex: 3×8' seuil (récup 3') ou 10×1' vite / 1' lent.";
  if (goal === "Semi-marathon") return focus === "Taper" ? "Rappel tempo léger." : "Ex: 2×15' allure semi (récup 3').";
  if (goal === "Marathon") return focus === "Taper" ? "Rappel tempo très contrôlé." : "Ex: tempo contrôlé + blocs réguliers.";
  return "Ex: 3×8' soutenu (récup 3').";
}

/**
 * Charge simple (MVP) :
 * - si target.rpe présent => load ≈ durationMin * rpe
 * - sinon load ≈ durationMin * 3 (EF)
 * Clamp pour éviter explosions.
 */
function computeSessionLoad(durationMin?: number, target?: SessionTarget): number | undefined {
  const d = typeof durationMin === "number" && Number.isFinite(durationMin) ? durationMin : 0;
  if (d <= 0) return undefined;

  const rpe = target?.rpe;
  const k = typeof rpe === "number" && Number.isFinite(rpe) ? clamp(rpe, 1, 10) : 3;
  const load = d * k;

  // borne “safe” (tu peux ajuster)
  return clamp(Math.round(load), 0, 220);
}

/* --------------------------------- generator -------------------------------- */

export function generatePlan(profile: Profile, program: Program): TrainingPlan {
  // futur: allures/contraintes via profile
  void profile;

  const weeksCount = goalWeeks(program.goal);
  const sessionsPerWeek = clampInt(program.sessionsPerWeek, 1, 6, 3);

  const trainingDays = buildTrainingDays(sessionsPerWeek, program.trainingDays);

  // lundi de départ : cette semaine
  const startMondayISO = getMondayISO(new Date());

  const baseKm = baseWeeklyKm(program.level);

  const weeks: TrainingWeek[] = Array.from({ length: weeksCount }, (_, wi) => {
    const weekIndex = wi + 1;
    const focus = weekFocus(weekIndex, weeksCount);

    const weekStartDate = addDaysISO(startMondayISO, wi * 7);

    // total km semaine
    const totalKm = weekTotalKm(baseKm, weekIndex, weeksCount, focus);

    /**
     * Répartition km :
     * - 1 séance : 100% SL
     * - 2 séances : 60% EF / 40% SL
     * - ≥3 séances : 50% EF / 25% Qualité / 25% SL
     * - Taper : moins de qualité (plus safe)
     */
    const hasQuality = trainingDays.length >= 3;

    const [easyKm, qualityKm, longKm] = (() => {
      if (trainingDays.length === 1) return [0, 0, totalKm] as const;

      if (trainingDays.length === 2) {
        const [easy, long] = splitInt(totalKm, [0.6, 0.4]);
        return [easy, 0, long] as const;
      }

      if (focus === "Taper") {
        const [easy, quality, long] = splitInt(totalKm, [0.6, 0.15, 0.25]);
        return [easy, quality, long] as const;
      }

      const [easy, quality, long] = splitInt(totalKm, [0.5, 0.25, 0.25]);
      return [easy, quality, long] as const;
    })();

    // Slots “dans la semaine” (dans trainingDays, pas dayIndex calendrier)
    const longSlot = Math.max(0, trainingDays.length - 1);
    const qualitySlot = hasQuality ? 1 : -1;

    // Distribuer easy sur le reste
    const easySlots = trainingDays
      .map((_, idx) => idx)
      .filter((idx) => idx !== longSlot && idx !== qualitySlot);

    const perEasy = easySlots.length ? splitInt(easyKm, easySlots.map(() => 1)) : [];
    let easyCursor = 0;

    const sessions: TrainingSession[] = trainingDays.map((dayIndex, slot) => {
      let workout: WorkoutKey = "EF";
      let distanceKm: number | undefined;

      if (slot === longSlot) {
        workout = "SL";
        distanceKm = longKm > 0 ? longKm : undefined;
      } else if (slot === qualitySlot) {
        workout = "QUALITE";
        distanceKm = qualityKm > 0 ? qualityKm : undefined;
      } else {
        workout = "EF";
        const km = perEasy[easyCursor] ?? 0;
        easyCursor += 1;
        distanceKm = km > 0 ? km : undefined;
      }

      // Durée approx (si pas de distance, laisse undefined)
      // paces grossiers (min/km)
      const pace =
        workout === "QUALITE" ? 5.1 : workout === "EF" ? 6.2 : 6.0;

      const durationMin =
        typeof distanceKm === "number" && Number.isFinite(distanceKm) && distanceKm > 0
          ? Math.max(20, Math.round(distanceKm * pace))
          : undefined;

      const kind = sessionKindFor(workout);
      const target = targetFor(workout, program.goal);
      const load = computeSessionLoad(durationMin, target);

      const sessionId = `s_${weekStartDate}_${dayIndex}_${workout}`;

      const tags: string[] = [];
      tags.push(focus.toLowerCase());
      if (workout === "SL") tags.push("long");
      if (workout === "QUALITE") tags.push("quality");
      if (workout === "EF") tags.push("easy");

      return {
        sessionId,
        dayIndex,
        kind,
        title: titleFor(workout),
        description: descriptionFor(workout, program.goal, focus),
        target,
        durationMin,
        distanceKm,
        load,
        tags,
      };
    });

    const phase = focus === "Base" ? "base" : focus === "Spécifique" ? "specifique" : "taper";
    const label = `Semaine ${weekIndex} — ${focus}`;

    return {
      weekIndex,
      startDate: weekStartDate,
      label,
      phase,
      sessions,
    };
  });

  const plan: TrainingPlan = {
    planId: `plan_${Date.now()}`,
    goal: program.goal,
    level: program.level,
    weeks,
    createdAt: isoNow(),
    version: 2,
  };

  return plan;
}
