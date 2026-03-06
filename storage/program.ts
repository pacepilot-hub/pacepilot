// storage/program.ts
/**
 * ✅ Program (UI types) — Beta-ready, multi-sport friendly
 *
 * Rôle:
 * - Types "UI-friendly" uniquement (petits enums, helpers)
 * - Le plan complet reste dans storage/weeklyPlan.ts (source of truth)
 *
 * Notes:
 * - On garde WorkoutType pour l'UI "course/trail"
 * - Pour le multi-sport, on introduit SportFocus (sports choisis à l'onboarding)
 * - On ajoute des normalizers robustes (libellés libres -> enums)
 */

import type { Goal, Level, SessionsPerWeek } from "./onboarding";

/* --------------------------------- sports --------------------------------- */

/**
 * Sports sélectionnables à l’onboarding.
 * Tu m’as demandé: course, trail, vélo route, VTT, randonnée, natation (multi-sélection).
 */
export const SPORT_FOCUS = [
  "Course à pied",
  "Trail",
  "Vélo route",
  "VTT",
  "Randonnée",
  "Natation",
] as const;

export type SportFocus = (typeof SPORT_FOCUS)[number];

export function isSportFocus(x: unknown): x is SportFocus {
  return typeof x === "string" && (SPORT_FOCUS as readonly string[]).includes(x);
}

export function normalizeSportFocus(input: unknown): SportFocus | null {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;

  if (s.includes("trail")) return "Trail";
  if (s.includes("course") || s.includes("running") || s.includes("run")) return "Course à pied";

  if (s.includes("vtt") || s.includes("mtb")) return "VTT";
  if (s.includes("velo route") || s.includes("route") || s.includes("road bike")) return "Vélo route";
  if (s === "velo" || s.includes("vélo") || s.includes("velo") || s.includes("bike")) return "Vélo route";

  if (s.includes("rando") || s.includes("randonn") || s.includes("hike")) return "Randonnée";
  if (s.includes("natation") || s.includes("swim")) return "Natation";

  return null;
}

/** dedupe + filtre + tri stable selon SPORT_FOCUS */
export function normalizeSportFocusList(input: unknown): SportFocus[] {
  const arr = Array.isArray(input) ? input : input == null ? [] : [input];

  const out: SportFocus[] = [];
  for (const it of arr) {
    const n = normalizeSportFocus(it);
    if (n && !out.includes(n)) out.push(n);
  }

  // tri stable selon l’ordre officiel
  out.sort((a, b) => SPORT_FOCUS.indexOf(a) - SPORT_FOCUS.indexOf(b));
  return out;
}

/* --------------------------------- workout -------------------------------- */

/**
 * Workouts “course/trail” (plan hebdo)
 * -> on peut étendre plus tard par sport.
 */
export const WORKOUT_TYPES = [
  "Repos",
  "EF",
  "Fractionné",
  "Seuil",
  "Sortie longue",
  "Renfo",
  "Vélo",
] as const;

export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export function isWorkoutType(x: unknown): x is WorkoutType {
  return typeof x === "string" && (WORKOUT_TYPES as readonly string[]).includes(x);
}

/**
 * Normalise un libellé libre vers un WorkoutType (fallback "EF").
 * Utile si tes sources sont parfois "footing", "long", "interv", etc.
 */
export function normalizeWorkoutType(input: unknown): WorkoutType {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s) return "EF";

  if (s.includes("repos") || s.includes("rest")) return "Repos";
  if (s.includes("renfo") || s.includes("strength") || s.includes("muscu")) return "Renfo";
  if (s.includes("vélo") || s.includes("velo") || s.includes("bike") || s.includes("cycling")) return "Vélo";

  if (s.includes("fraction") || s.includes("interv") || s.includes("vma")) return "Fractionné";
  if (s.includes("seuil") || s.includes("tempo") || s.includes("threshold")) return "Seuil";
  if (s.includes("long") || s.includes("sortie longue") || s.includes("sl")) return "Sortie longue";

  if (s.includes("ef") || s.includes("endurance") || s.includes("footing") || s.includes("easy")) return "EF";

  return "EF";
}

/** Label court (UI) */
export function workoutShortLabel(t: WorkoutType): string {
  switch (t) {
    case "Sortie longue":
      return "SL";
    case "Fractionné":
      return "Frac";
    default:
      return t;
  }
}

/* --------------------------------- summary -------------------------------- */

export type ProgramSummary = Readonly<{
  goal: Goal;
  level: Level;
  sessionsPerWeek: SessionsPerWeek;
}>;

/* --------------------------- optional conveniences -------------------------- */

/**
 * Petit helper pratique: “sport principal” pour l’app v1.
 * (Tu démarres par Course/Trail: on choisit la 1ère option pertinente.)
 */
export function pickPrimarySport(sports: SportFocus[] | undefined | null): SportFocus {
  const list = Array.isArray(sports) ? sports : [];
  if (list.includes("Course à pied")) return "Course à pied";
  if (list.includes("Trail")) return "Trail";
  return list[0] ?? "Course à pied";
}
