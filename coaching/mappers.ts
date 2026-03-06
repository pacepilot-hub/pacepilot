// coaching/mappers.ts
// 🧩 Vocabulaire commun Plan ↔ Activités ↔ IA ↔ UI
// Objectifs:
// - Un seul endroit pour convertir WorkoutType / ActivityType / ActivityKind / Session -> meta commun
// - Un seul endroit pour labels UI + catégories + effortTag + "key session"
// - Une source unique de "load" (charge) + agrégations
// - Zéro dépendance UI (pas de theme/components)

import type { WorkoutType } from "@/storage/program";
import type { Activity, ActivityType, ActivityKind } from "@/storage/activities";
import type { Intensity, Session } from "@/storage/trainingPlan";

import { toISODateLocal, parseISODateLocal, weekStartFromISO } from "@/coaching/dates";

/* --------------------------------- types --------------------------------- */

export type SessionCategory = "rest" | "recovery" | "easy" | "quality" | "long" | "cross";

export type UiWorkoutLabel =
  | "Repos"
  | "EF"
  | "Fractionné"
  | "Seuil"
  | "Sortie longue"
  | "Renfo"
  | "Mobilité"
  | "Vélo"
  | "Rando"
  | "Trail"
  | "Course"
  | "Séance";

export type EffortTag = "easy" | "moderate" | "hard" | "very_hard" | "unknown";

export type WorkoutMeta = {
  intensity: Intensity;
  category: SessionCategory;
  uiLabel: UiWorkoutLabel;
  isKey: boolean;
  effortTag: EffortTag;
};

export type RangeSummary = {
  fromISO: string;
  toISO: string;
  count: number;

  load: number;
  minutes: number;
  elevation: number;

  qualityCount: number;
  longCount: number;
  recoveryCount: number;
  trailCount: number;

  loadByCategory: Record<SessionCategory, number>;
};

export type WeekBucket = {
  weekStartISO: string; // lundi
  load: number;
  minutes: number;
  elevation: number;
  count: number;
};

/* -------------------------------- utilities ------------------------------ */

function norm(s: unknown): string {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round(n: number) {
  return Math.round(Number.isFinite(n) ? n : 0);
}

export function isISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

export function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.trunc(n));
  return toISODateLocal(d);
}

export function jsDowToMon0(jsDow: number): number {
  // JS: 0=Dim ... 6=Sam  ->  Mon0: 0=Lun ... 6=Dim
  return jsDow === 0 ? 6 : jsDow - 1;
}

/**
 * ✅ Semaine (lundi) à partir d’un ISO "YYYY-MM-DD"
 * Utilise dates.ts (safe), évite tout piège UTC/local.
 */
export function weekStartISO(dateISO: string): string {
  if (!isISODate(dateISO)) return String(dateISO ?? "");
  return weekStartFromISO(dateISO);
}

/* --------------------------- intensity & category -------------------------- */

export function isQualityIntensity(intensity: Intensity): boolean {
  return intensity === "INTERVAL" || intensity === "THRESHOLD" || intensity === "TEMPO";
}
export function isRecoveryIntensity(intensity: Intensity): boolean {
  return intensity === "RECOVERY";
}
export function isLongIntensity(intensity: Intensity): boolean {
  return intensity === "LONG";
}

export function intensityToCategory(intensity: Intensity): SessionCategory {
  if (intensity === "RECOVERY") return "recovery";
  if (intensity === "LONG") return "long";
  if (isQualityIntensity(intensity)) return "quality";
  return "easy";
}

export function intensityToUiLabel(intensity: Intensity): UiWorkoutLabel {
  switch (intensity) {
    case "INTERVAL":
      return "Fractionné";
    case "THRESHOLD":
    case "TEMPO":
      return "Seuil";
    case "LONG":
      return "Sortie longue";
    case "RECOVERY":
      return "Mobilité";
    case "EASY":
    default:
      return "EF";
  }
}

export function intensityToEffortTag(intensity: Intensity): EffortTag {
  switch (intensity) {
    case "RECOVERY":
    case "EASY":
      return "easy";
    case "LONG":
      return "moderate";
    case "THRESHOLD":
    case "TEMPO":
      return "hard";
    case "INTERVAL":
      return "very_hard";
    default:
      return "unknown";
  }
}

function metaFrom(intensity: Intensity, overrides?: Partial<WorkoutMeta>): WorkoutMeta {
  const base: WorkoutMeta = {
    intensity,
    category: intensityToCategory(intensity),
    uiLabel: intensityToUiLabel(intensity),
    isKey: isQualityIntensity(intensity) || intensity === "LONG",
    effortTag: intensityToEffortTag(intensity),
  };

  const merged: WorkoutMeta = { ...base, ...(overrides ?? {}) };

  // garde-fous
  if (merged.category === "rest") {
    merged.intensity = "RECOVERY";
    merged.isKey = false;
    merged.effortTag = "easy";
  }
  if (merged.category === "cross") {
    merged.intensity = "RECOVERY";
    merged.isKey = false;
    if (merged.effortTag === "unknown") merged.effortTag = "easy";
  }

  return merged;
}

/* -------------------- 1) WorkoutType (WeeklyPlan legacy) ------------------ */

export function workoutTypeToMeta(w: WorkoutType): WorkoutMeta {
  switch (w) {
    case "Repos":
      return metaFrom("RECOVERY", { category: "rest", uiLabel: "Repos", isKey: false, effortTag: "easy" });
    case "EF":
      return metaFrom("EASY", { category: "easy", uiLabel: "EF", isKey: false, effortTag: "easy" });
    case "Fractionné":
      return metaFrom("INTERVAL", { category: "quality", uiLabel: "Fractionné", isKey: true, effortTag: "very_hard" });
    case "Seuil":
      return metaFrom("THRESHOLD", { category: "quality", uiLabel: "Seuil", isKey: true, effortTag: "hard" });
    case "Sortie longue":
      return metaFrom("LONG", { category: "long", uiLabel: "Sortie longue", isKey: true, effortTag: "moderate" });
    case "Renfo":
      return metaFrom("RECOVERY", { category: "recovery", uiLabel: "Renfo", isKey: false, effortTag: "easy" });
    case "Vélo":
      return metaFrom("RECOVERY", { category: "cross", uiLabel: "Vélo", isKey: false, effortTag: "easy" });
    default:
      return metaFrom("EASY", { category: "easy", uiLabel: "Séance", isKey: false, effortTag: "unknown" });
  }
}

export function workoutTypeToIntensity(w: WorkoutType): Intensity {
  return workoutTypeToMeta(w).intensity;
}

/* --------------------------- 2) ActivityType logs -------------------------- */

export function activityTypeToMeta(t: ActivityType): WorkoutMeta {
  switch (t) {
    case "rest":
      return metaFrom("RECOVERY", { category: "rest", uiLabel: "Repos", isKey: false, effortTag: "easy" });
    case "easy":
      return metaFrom("EASY", { category: "easy", uiLabel: "EF", isKey: false, effortTag: "easy" });
    case "tempo":
      return metaFrom("THRESHOLD", { category: "quality", uiLabel: "Seuil", isKey: true, effortTag: "hard" });
    case "intervals":
      return metaFrom("INTERVAL", { category: "quality", uiLabel: "Fractionné", isKey: true, effortTag: "very_hard" });
    case "long":
      return metaFrom("LONG", { category: "long", uiLabel: "Sortie longue", isKey: true, effortTag: "moderate" });
    case "race":
      return metaFrom("THRESHOLD", { category: "quality", uiLabel: "Course", isKey: true, effortTag: "very_hard" });
    case "cross":
      return metaFrom("RECOVERY", { category: "cross", uiLabel: "Vélo", isKey: false, effortTag: "easy" });
    default:
      return metaFrom("EASY", { category: "easy", uiLabel: "Séance", isKey: false, effortTag: "unknown" });
  }
}

export function activityTypeToIntensity(t: ActivityType): Intensity {
  return activityTypeToMeta(t).intensity;
}

/* ----------------------------- 3) ActivityKind ----------------------------- */

export function activityKindToUiLabel(kind?: ActivityKind): UiWorkoutLabel {
  switch (kind) {
    case "trail_run":
      return "Trail";
    case "hike":
    case "walk":
      return "Rando";
    case "bike":
      return "Vélo";
    case "run":
      return "Séance";
    case "other":
    default:
      return "Séance";
  }
}

/* ------------------------------ 4) Activity -> meta ------------------------ */

export function safeRpe(a: Activity): number | null {
  const r = typeof a.rpe === "number" && Number.isFinite(a.rpe) ? a.rpe : null;
  if (r == null) return null;
  return clamp(Math.round(r), 1, 10);
}

export function safeElevation(a: Activity): number {
  const e = typeof a.elevationGainM === "number" && Number.isFinite(a.elevationGainM) ? a.elevationGainM : 0;
  return Math.max(0, Math.round(e));
}

export function activityToMeta(a: Activity): WorkoutMeta {
  const base = activityTypeToMeta(a.type);

  switch (a.kind) {
    case "bike":
      return metaFrom("RECOVERY", { category: "cross", uiLabel: "Vélo", isKey: false, effortTag: "easy" });

    case "hike":
    case "walk":
      return metaFrom("RECOVERY", { category: "recovery", uiLabel: "Rando", isKey: false, effortTag: "easy" });

    case "trail_run": {
      const elev = safeElevation(a);
      const upgraded: EffortTag = elev >= 400 && base.effortTag === "easy" ? "moderate" : base.effortTag;
      return { ...base, uiLabel: "Trail", effortTag: upgraded };
    }

    default:
      return base;
  }
}

/* ------------------------------ 5) Session -> meta ------------------------- */

export function sessionToMeta(s: Session): WorkoutMeta {
  const l = norm(s.label);

  if (l.includes("repos")) return metaFrom("RECOVERY", { category: "rest", uiLabel: "Repos", isKey: false, effortTag: "easy" });

  if (l.includes("mobil") || l.includes("étir") || l.includes("etir")) {
    return metaFrom("RECOVERY", { category: "recovery", uiLabel: "Mobilité", isKey: false, effortTag: "easy" });
  }

  if (l.includes("renfo")) return metaFrom("RECOVERY", { category: "recovery", uiLabel: "Renfo", isKey: false, effortTag: "easy" });

  if (l.includes("vélo") || l.includes("velo") || l.includes("bike")) {
    return metaFrom("RECOVERY", { category: "cross", uiLabel: "Vélo", isKey: false, effortTag: "easy" });
  }

  if (l.includes("rando") || l.includes("marche") || l.includes("walk") || l.includes("hike")) {
    return metaFrom("RECOVERY", { category: "recovery", uiLabel: "Rando", isKey: false, effortTag: "easy" });
  }

  if (l.includes("trail")) return metaFrom(s.intensity ?? "EASY", { category: "easy", uiLabel: "Trail", effortTag: "moderate" });

  if (l.includes("long")) return metaFrom("LONG", { category: "long", uiLabel: "Sortie longue", isKey: true, effortTag: "moderate" });

  if (l.includes("seuil") || l.includes("tempo")) {
    return metaFrom("THRESHOLD", { category: "quality", uiLabel: "Seuil", isKey: true, effortTag: "hard" });
  }

  if (l.includes("interv") || l.includes("fraction") || l.includes("vma")) {
    return metaFrom("INTERVAL", { category: "quality", uiLabel: "Fractionné", isKey: true, effortTag: "very_hard" });
  }

  return metaFrom(s.intensity ?? "EASY");
}

/* ---------------------- 6) Normalisations minutes / D+ ------------------- */

export function estimateMinutesFromActivity(a: Activity): number {
  if (typeof a.durationMin === "number" && Number.isFinite(a.durationMin)) {
    return clamp(Math.round(a.durationMin), 0, 24 * 60);
  }
  if (typeof a.distanceKm === "number" && Number.isFinite(a.distanceKm)) {
    // estimation prudente: 6:15/km
    return clamp(Math.round(a.distanceKm * 6.25), 10, 24 * 60);
  }
  return 0;
}

/* --------------------- 7) Load (charge) : source unique ------------------- */

export function activityLoad(a: Activity): number {
  const minutes = estimateMinutesFromActivity(a);
  if (minutes <= 0) return 0;

  const meta = activityToMeta(a);

  const intensityFactor =
    meta.intensity === "INTERVAL" ? 1.35 :
    meta.intensity === "THRESHOLD" || meta.intensity === "TEMPO" ? 1.20 :
    meta.intensity === "LONG" ? 1.15 :
    meta.intensity === "RECOVERY" ? 0.75 :
    1.0;

  const categoryFactor =
    meta.category === "cross" ? 0.90 :
    meta.category === "rest" ? 0.0 :
    1.0;

  const rpe = safeRpe(a);
  const rpeFactor = rpe ? (0.90 + rpe / 14) : 1.0; // ~0.97..1.61

  const elev = safeElevation(a);
  const elevFactor = elev > 0 ? 1 + clamp(elev / 1200, 0, 0.45) : 1.0;

  const kindBonus = a.kind === "trail_run" ? 1.07 : 1.0;

  const load = minutes * intensityFactor * categoryFactor * rpeFactor * elevFactor * kindBonus;
  return Number.isFinite(load) ? load : 0;
}

export function isKeyActivity(a: Activity): boolean {
  return activityToMeta(a).isKey;
}

export function isTrailActivity(a: Activity): boolean {
  return a.kind === "trail_run" || a.kind === "hike" || a.kind === "walk";
}

/* ------------------------------ 8) Agrégations ---------------------------- */

function emptyLoadByCategory(): Record<SessionCategory, number> {
  return { rest: 0, recovery: 0, easy: 0, quality: 0, long: 0, cross: 0 };
}

export function summarizeRange(activities: Activity[], fromISO: string, toISO: string): RangeSummary {
  const loadByCategory = emptyLoadByCategory();

  let load = 0;
  let minutes = 0;
  let elevation = 0;
  let count = 0;

  let qualityCount = 0;
  let longCount = 0;
  let recoveryCount = 0;
  let trailCount = 0;

  for (const a of activities) {
    if (!isISODate(a.date)) continue;
    if (a.date < fromISO || a.date > toISO) continue;

    count++;

    const m = estimateMinutesFromActivity(a);
    const e = safeElevation(a);
    const meta = activityToMeta(a);
    const l = activityLoad(a);

    load += l;
    minutes += m;
    elevation += e;

    loadByCategory[meta.category] += l;

    if (meta.category === "quality") qualityCount++;
    if (meta.category === "long") longCount++;
    if (meta.category === "recovery" || meta.category === "rest") recoveryCount++;
    if (isTrailActivity(a)) trailCount++;
  }

  const roundedLoadByCategory = Object.fromEntries(
    Object.entries(loadByCategory).map(([k, v]) => [k, round(v)])
  ) as Record<SessionCategory, number>;

  return {
    fromISO,
    toISO,
    count,
    load: round(load),
    minutes: round(minutes),
    elevation: round(elevation),
    qualityCount,
    longCount,
    recoveryCount,
    trailCount,
    loadByCategory: roundedLoadByCategory,
  };
}

export function bucketByWeek(activities: Activity[], fromISO: string, toISO: string): WeekBucket[] {
  const map = new Map<string, WeekBucket>();

  for (const a of activities) {
    if (!isISODate(a.date)) continue;
    if (a.date < fromISO || a.date > toISO) continue;

    const wk = weekStartISO(a.date);

    const m = estimateMinutesFromActivity(a);
    const e = safeElevation(a);
    const l = activityLoad(a);

    const prev = map.get(wk);
    if (!prev) {
      map.set(wk, { weekStartISO: wk, load: l, minutes: m, elevation: e, count: 1 });
    } else {
      prev.load += l;
      prev.minutes += m;
      prev.elevation += e;
      prev.count += 1;
    }
  }

  return Array.from(map.values())
    .sort((a, b) => (a.weekStartISO < b.weekStartISO ? -1 : a.weekStartISO > b.weekStartISO ? 1 : 0))
    .map((w) => ({
      ...w,
      load: round(w.load),
      minutes: round(w.minutes),
      elevation: round(w.elevation),
    }));
}
