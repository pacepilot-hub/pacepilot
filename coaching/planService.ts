// coaching/planService.ts
import * as onboarding from "@/storage/onboarding";
import { getWeeklyPlan, saveWeeklyPlan } from "@/storage/plans";
import { generateWeeklyPlan } from "@/coaching/planGenerator";
import { addDaysISO, getMondayISO, todayISO } from "@/coaching/dates";

import type { WeeklyPlan, WeeklyPlanDay, WeeklyPlanDays } from "@/storage/weeklyPlan";

import { listActivities } from "@/storage/activities";
import { computeDerivedState } from "@/coaching/derivedState";
import { decideTodaySession, reasonsToText } from "@/coaching/decisionEngine";

import type { Session, TrainingPlan, TrainingWeek } from "@/storage/trainingPlan";
import * as TrainingPlanStorage from "@/storage/trainingPlan";
import type { WorkoutType } from "@/storage/program";

/**
 * Plan service (refactor robuste)
 * ✅ fingerprinting clair + versioning
 * ✅ dates locales (via coaching/dates.ts)
 * ✅ “IA silencieuse” : patch du jour (aiStamp) sans regen tout le plan
 * ✅ guards onboarding + erreurs DB
 * ✅ TrainingPlan complet : N semaines, focus + estimation km
 *
 * ⚠️ IMPORTANT:
 * TrainingPlanStorage sanitize strict -> ne conserve pas les champs non typés (fingerprint, planStartMondayISO, etc.).
 * Donc on utilise planId comme "fingerprint persisté".
 */

/* -------------------------------------------------------------------------- */
/*                                   Dates                                    */
/* -------------------------------------------------------------------------- */

// Lun=0 ... Dim=6
function todayIndexMon0(): number {
  const js = new Date().getDay(); // Dim=0
  return js === 0 ? 6 : js - 1;
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  const v = Math.round(x);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/* -------------------------------------------------------------------------- */
/*                               Fingerprinting                               */
/* -------------------------------------------------------------------------- */

type FingerprintArgs = {
  goal: string;
  level: string;
  sessionsPerWeek: number;
  weekStartDate: string; // Monday ISO
};

function makeFingerprint(a: FingerprintArgs) {
  // v2 pour faire évoluer sans casser
  return `wpv2|${a.goal}|${a.level}|${a.sessionsPerWeek}|${a.weekStartDate}`;
}

type TrainingFingerprintArgs = {
  goal: string;
  level: string;
  sessionsPerWeek: number;
  planWeeks: number;
  planStartMondayISO: string;
};

function makeTrainingFingerprint(a: TrainingFingerprintArgs) {
  return `tpv2|${a.goal}|${a.level}|${a.sessionsPerWeek}|${a.planWeeks}|${a.planStartMondayISO}`;
}

/* -------------------------------------------------------------------------- */
/*                              Onboarding guard                              */
/* -------------------------------------------------------------------------- */

type OnboardingProgramGuard = onboarding.OnboardingSave & {
  program: Required<
    Pick<
      NonNullable<onboarding.OnboardingSave["program"]>,
      "goal" | "level" | "sessionsPerWeek" | "trainingDays"
    >
  >;
};

function canUseProgram(ob: onboarding.OnboardingSave | null): ob is OnboardingProgramGuard {
  const p: any = (ob as any)?.program;
  const spw = p?.sessionsPerWeek;

  const okSpw = spw === 2 || spw === 3 || spw === 4 || spw === 5 || spw === 6;
  const okDays = Array.isArray(p?.trainingDays) && p.trainingDays.length >= 1;

  return Boolean(p?.goal && p?.level && okSpw && okDays);
}

/* -------------------------------------------------------------------------- */
/*                       WeeklyPlan <-> Session mapping                        */
/* -------------------------------------------------------------------------- */

function weeklyWorkoutToPlannedSession(day: WeeklyPlanDay): Session {
  const rawDow = (day as any)?.dowIndex;
  const dow = clampInt(rawDow, 0, 6, todayIndexMon0());

  const w = (day as any)?.workout as WorkoutType | undefined;
  const details = typeof (day as any)?.details === "string" ? (day as any).details : "";

  const defaults: Record<WorkoutType, number> = {
    Repos: 0,
    EF: 35,
    Fractionné: 45,
    Seuil: 45,
    "Sortie longue": 75,
    Renfo: 20,
    Vélo: 45,
  };

  const durationMin = defaults[w ?? "EF"] ?? 35;

  if (w === "Repos") {
    return {
      dayOfWeek: dow,
      label: "Repos",
      intensity: "RECOVERY",
      durationMin: 0,
      notes: details || "Repos / récupération.",
    };
  }

  if (w === "Renfo") {
    return {
      dayOfWeek: dow,
      label: "Renfo (léger)",
      intensity: "RECOVERY",
      durationMin,
      notes: details || "Mobilité douce + renforcement léger.",
    };
  }

  if (w === "Vélo") {
    return {
      dayOfWeek: dow,
      label: "Vélo (facile)",
      intensity: "RECOVERY",
      durationMin,
      notes: details || "Facile, sans forcer. Objectif: récupérer.",
    };
  }

  if (w === "Fractionné") {
    return { dayOfWeek: dow, label: "Intervalles", intensity: "INTERVAL", durationMin, notes: details };
  }

  if (w === "Seuil") {
    return { dayOfWeek: dow, label: "Tempo / seuil", intensity: "THRESHOLD", durationMin, notes: details };
  }

  if (w === "Sortie longue") {
    return { dayOfWeek: dow, label: "Sortie longue", intensity: "LONG", durationMin, notes: details };
  }

  return { dayOfWeek: dow, label: "Footing", intensity: "EASY", durationMin, notes: details };
}

/** Mapping Session IA -> strings UI WeeklyPlan (workout/details) */
function sessionToWeeklyDayPatch(s: Session): { workout: WorkoutType; details: string } {
  const mins = typeof s.durationMin === "number" && s.durationMin > 0 ? `${Math.round(s.durationMin)} min` : "";

  const notes = String(s.notes ?? "").trim();
  const label = String(s.label ?? "").trim();

  let workout: WorkoutType;

  if (s.intensity === "LONG") workout = "Sortie longue";
  else if (s.intensity === "INTERVAL") workout = "Fractionné";
  else if (s.intensity === "THRESHOLD" || s.intensity === "TEMPO") workout = "Seuil";
  else if (s.intensity === "RECOVERY") {
    const l = label.toLowerCase();
    if (l.includes("velo") || l.includes("vélo") || l.includes("bike")) workout = "Vélo";
    else if (l.includes("renfo")) workout = "Renfo";
    else workout = "Repos";
  } else {
    workout = "EF";
  }

  const detailsStr = [mins, notes || label].filter(Boolean).join(" · ");
  return { workout, details: detailsStr };
}

/* -------------------------------------------------------------------------- */
/*                     WeeklyPlan : IA patch du jour                           */
/* -------------------------------------------------------------------------- */

async function applyTodayAIPatchIfNeeded(plan: WeeklyPlan): Promise<WeeklyPlan> {
  // Patch uniquement sur les plans générés (pas sur un futur plan “manuel”)
  if (plan.source !== "generated") return plan;
  if (!Array.isArray(plan.days) || plan.days.length !== 7) return plan;

  const idx = todayIndexMon0();
  const today = plan.days[idx];
  if (!today) return plan;

  const stamp = todayISO(); // YYYY-MM-DD local
  if ((today as any).aiStamp === stamp) return plan; // déjà patché aujourd’hui

  const activities = await listActivities().catch(() => []);
  const state = computeDerivedState(activities);

  const planned = weeklyWorkoutToPlannedSession(today);

  const decision = decideTodaySession({
    planned,
    state,
    recentActivities: activities,
    options: { minEffectiveMinutes: 20, softenIntensity: true },
  });

  const patch = sessionToWeeklyDayPatch(decision.session);

  // ✅ conserve l'invariant tuple [7]
  const nextDays = [...plan.days] as unknown as WeeklyPlanDays;

  nextDays[idx] = {
    ...today,
    workout: patch.workout,
    details: patch.details,

    // stamp / meta IA
    aiStamp: stamp,
    aiMode: decision.mode,
    aiConfidence: decision.confidence,

    // UI-safe
    aiReasonsText: reasonsToText(decision.reasons),

    // debug/futur
    aiReasons: decision.reasons,
    aiFallback: decision.fallback,
  } as any;

  const nextPlan: WeeklyPlan = { ...plan, days: nextDays };

  await saveWeeklyPlan(nextPlan).catch(() => {});
  return nextPlan;
}

/* -------------------------------------------------------------------------- */
/*                               ensureWeeklyPlan                              */
/* -------------------------------------------------------------------------- */

export async function ensureWeeklyPlan(): Promise<WeeklyPlan | null> {
  try {
    const ob = await onboarding.loadOnboarding().catch(() => null);
    if (!canUseProgram(ob)) return null;

    const p = ob.program;
    const weekStartDate = getMondayISO(new Date());

    const fp = makeFingerprint({
      goal: String(p.goal),
      level: String(p.level),
      sessionsPerWeek: p.sessionsPerWeek,
      weekStartDate,
    });

    const existing = await getWeeklyPlan().catch(() => null);

    // ⚠️ si ton storage "weeklyPlan" drop fingerprint, tu peux basculer la comparaison sur id
    const mustRegen =
      !existing ||
      existing.source == null ||
      (existing.source === "generated" && (!existing.fingerprint || existing.fingerprint !== fp));

    if (!mustRegen && existing) {
      return await applyTodayAIPatchIfNeeded(existing);
    }

    const planBase = generateWeeklyPlan({
      weekStartDate,
      goal: p.goal as any,
      level: p.level as any,
      sessionsPerWeek: p.sessionsPerWeek,
      trainingDays: p.trainingDays,
    });

    const plan: WeeklyPlan = { ...(planBase as WeeklyPlan), fingerprint: fp };

    await saveWeeklyPlan(plan).catch(() => {});
    return await applyTodayAIPatchIfNeeded(plan);
  } catch (e) {
    console.error("[ensureWeeklyPlan]", e);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                          TrainingPlan (plan complet)                         */
/* -------------------------------------------------------------------------- */

function focusForWeek(weekIndex1: number, planWeeks: number): TrainingWeek["focus"] {
  const taperWeeks = Math.max(2, Math.round(planWeeks * 0.15));
  const baseWeeks = Math.max(3, Math.round(planWeeks * 0.33));

  if (weekIndex1 > planWeeks - taperWeeks) return "Taper";
  if (weekIndex1 <= baseWeeks) return "Base";
  return "Spécifique";
}

function estimateTotalKm(level: string, sessionsPerWeek: number, focus: TrainingWeek["focus"]) {
  const lvl = String(level ?? "").toLowerCase();

  const base =
    lvl.includes("debut") || lvl.includes("début")
      ? 25
      : lvl.includes("avance") || lvl.includes("avancé")
      ? 55
      : 40;

  const spwFactor = 0.85 + Math.min(0.3, sessionsPerWeek * 0.05); // 2→0.95, 6→1.15
  let km = base * spwFactor;

  if (focus === "Spécifique") km *= 1.1;
  if (focus === "Taper") km *= 0.7;

  return Math.max(15, Math.round(km));
}

/**
 * Plan complet :
 * - génère N semaines via generateWeeklyPlan
 * - convertit en TrainingWeek.sessions (Session[])
 * - stocke via TrainingPlanStorage
 *
 * ✅ Fix critique : compare sur existing.planId (persisté) au lieu de fingerprint (non persisté)
 */
export async function ensureTrainingPlan(planWeeks = 12): Promise<TrainingPlan | null> {
  try {
    const ob = await onboarding.loadOnboarding().catch(() => null);
    if (!canUseProgram(ob)) return null;

    const p = ob.program;
    const planStartMondayISO = getMondayISO(new Date());

    const fp = makeTrainingFingerprint({
      goal: String(p.goal),
      level: String(p.level),
      sessionsPerWeek: p.sessionsPerWeek,
      planWeeks,
      planStartMondayISO,
    });

    const existing = await TrainingPlanStorage.loadTrainingPlan().catch(() => null);

    // ✅ compare sur planId (persisté par sanitize)
    const mustRegen = !existing || !existing.weeks?.length || existing.planId !== fp;
    if (!mustRegen && existing) return existing;

    const weeks: TrainingWeek[] = [];

    for (let i = 0; i < planWeeks; i++) {
      const weekIndex1 = i + 1;
      const focus = focusForWeek(weekIndex1, planWeeks);
      const weekStartDate = addDaysISO(planStartMondayISO, i * 7);

      const weekBase = generateWeeklyPlan({
        weekStartDate,
        goal: p.goal as any,
        level: p.level as any,
        sessionsPerWeek: p.sessionsPerWeek,
        trainingDays: p.trainingDays,
      }) as WeeklyPlan;

      const days: WeeklyPlanDay[] = Array.isArray((weekBase as any)?.days) ? (weekBase as any).days : [];

      // garde-fou : si un générateur renvoie un truc tordu
      if (days.length === 0) continue;

      const sessions: Session[] = days.map((d) => weeklyWorkoutToPlannedSession(d));
      const totalKm = estimateTotalKm(String(p.level), p.sessionsPerWeek, focus);

      weeks.push({ weekIndex: weekIndex1, focus, totalKm, sessions });
    }

    if (weeks.length === 0) return null;

    const plan: TrainingPlan = {
      planId: fp,
      goal: String(p.goal),
      level: String(p.level),
      weeks,
      createdAt: new Date().toISOString(),
      version: 2,
    };

    await TrainingPlanStorage.saveTrainingPlan(plan).catch(() => {});
    return plan;
  } catch (e) {
    console.error("[ensureTrainingPlan]", e);
    return null;
  }
}
