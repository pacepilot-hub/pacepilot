// storage/weeklyPlan.ts
import type { WorkoutType } from "./program";
import type { Session } from "@/storage/trainingPlan";
import type { DecisionMode, DecisionReason } from "@/coaching/decisionEngine";
import type { Confidence } from "@/coaching/derivedState";

/* --------------------------------- aliases -------------------------------- */

export type ISODate = string; // "YYYY-MM-DD"
export type DowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Lun..Dim
export type WeeklyPlanSource = "generated" | "edited";

/* --------------------------------- plan day -------------------------------- */

export type WeeklyPlanDay = Readonly<{
  /** "YYYY-MM-DD" (référence: Europe/Paris côté app) */
  date: ISODate;

  /** 0..6 (Lun..Dim) */
  dowIndex: DowIndex;

  /** type de séance (UI) */
  workout: WorkoutType;

  /** détails libres (ex: "1h10 EF + 6x20s") */
  details: string;

  /** planifié (optionnel) */
  plannedDistanceKm?: number;
  plannedDurationMin?: number;

  /* ----------------------------- IA (optionnel) ---------------------------- */

  /** cache stamp (quand l’IA a évalué/ajusté) */
  aiStamp?: ISODate;

  /** mode décisionnel */
  aiMode?: DecisionMode;

  /** confiance globale */
  aiConfidence?: Confidence;

  /** raisons courtes, UI-friendly */
  aiReasonsText?: ReadonlyArray<string>;

  /** raisons brutes (debug / futur) */
  aiReasons?: ReadonlyArray<DecisionReason>;

  /** fallback de sécurité */
  aiFallback?: Session;
}>;

/** 7 jours garantis (Lun..Dim) */
export type WeeklyPlanDays = readonly [
  WeeklyPlanDay,
  WeeklyPlanDay,
  WeeklyPlanDay,
  WeeklyPlanDay,
  WeeklyPlanDay,
  WeeklyPlanDay,
  WeeklyPlanDay
];

/* --------------------------------- plan ---------------------------------- */

export type WeeklyPlan = Readonly<{
  id: string;

  /** lundi de la semaine, "YYYY-MM-DD" */
  weekStartDate: ISODate;

  /** label UI (ex: "Semaine 3 • Affûtage") */
  weekLabel: string;

  /** timestamp ms */
  createdAt: number;

  /** provenance */
  source: WeeklyPlanSource;

  /** optionnel: hash/stamp des entrées (profil + programme + activités) */
  fingerprint?: string;

  /** 7 jours attendus */
  days: WeeklyPlanDays;
}>;

/* --------------------------------- utils --------------------------------- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  const v = Math.round(x);
  return clamp(v, min, max);
}

export function isISODate(v: unknown): v is ISODate {
  return typeof v === "string" && ISO_RE.test(v);
}

/**
 * Parsing "YYYY-MM-DD" en local, sans décalage UTC.
 * (new Date("YYYY-MM-DD") => UTC => peut décaler en Europe/Paris)
 */
export function parseISODateLocal(iso: ISODate): Date | null {
  if (!isISODate(iso)) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // midi local pour éviter DST edge-cases
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/** "YYYY-MM-DD" en local (cohérent UI) */
export function ymd(d: Date = new Date()): ISODate {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * JS Date -> index 0..6 (Lun..Dim)
 * (JS: 0=Dim..6=Sam)
 */
export function dowIndexFromDate(d: Date): DowIndex {
  const js = d.getDay();
  const idx = js === 0 ? 6 : js - 1;
  return idx as DowIndex;
}

export function todayIndex(d: Date = new Date()): DowIndex {
  return dowIndexFromDate(d);
}

/**
 * Lundi de la semaine (ISODate), basé sur date locale.
 */
export function weekStartISO(d: Date = new Date()): ISODate {
  const x = new Date(d);
  const idx = dowIndexFromDate(x); // 0=lun
  x.setDate(x.getDate() - idx);
  return ymd(x);
}

/** Ajoute N jours à une ISODate (local, stable) */
export function addDaysISO(start: ISODate, addDays: number): ISODate {
  const base = parseISODateLocal(start);
  if (!base) return start;
  const x = new Date(base);
  x.setDate(x.getDate() + addDays);
  return ymd(x);
}

/* ---------------------------- workout validation --------------------------- */

function isWorkoutTypeRuntime(v: unknown): v is WorkoutType {
  // compatible avec program.ts (WORKOUT_TYPES)
  // ⚠️ si tu ajoutes des types dans WORKOUT_TYPES, pense à étendre ici.
  return (
    v === "Repos" ||
    v === "EF" ||
    v === "Fractionné" ||
    v === "Seuil" ||
    v === "Sortie longue" ||
    v === "Renfo" ||
    v === "Vélo"
  );
}

/* ------------------------- runtime validation (strict) ---------------------- */

function looksLikeWeeklyPlanDay(v: unknown): v is WeeklyPlanDay {
  if (!isRecord(v)) return false;

  if (!isISODate((v as any).date)) return false;

  const dow = (v as any).dowIndex;
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) return false;

  if (!isWorkoutTypeRuntime((v as any).workout)) return false;

  const details = (v as any).details;
  if (typeof details !== "string") return false;

  // optionnels (validation légère)
  const pd = (v as any).plannedDistanceKm;
  if (pd != null && (!isFiniteNumber(pd) || pd < 0 || pd > 1000)) return false;

  const pm = (v as any).plannedDurationMin;
  if (pm != null && (!isFiniteNumber(pm) || pm < 0 || pm > 24 * 60)) return false;

  const aiStamp = (v as any).aiStamp;
  if (aiStamp != null && !isISODate(aiStamp)) return false;

  const aiReasonsText = (v as any).aiReasonsText;
  if (aiReasonsText != null) {
    if (!Array.isArray(aiReasonsText)) return false;
    if (!aiReasonsText.every((x: any) => typeof x === "string")) return false;
  }

  return true;
}

export function looksLikeWeeklyPlan(v: unknown): v is WeeklyPlan {
  if (!isRecord(v)) return false;

  if (!normStr((v as any).id)) return false;
  if (!isISODate((v as any).weekStartDate)) return false;
  if (typeof (v as any).weekLabel !== "string") return false;

  const createdAt = (v as any).createdAt;
  if (!isFiniteNumber(createdAt) || createdAt <= 0) return false;

  const source = (v as any).source;
  if (source !== "generated" && source !== "edited") return false;

  const days = (v as any).days;
  if (!Array.isArray(days) || days.length !== 7) return false;
  if (!days.every(looksLikeWeeklyPlanDay)) return false;

  return true;
}

/* ------------------------------ normalization ------------------------------ */

/**
 * Normalisation "bêta-safe":
 * - accepte un payload "presque bon"
 * - reconstruit les 7 dates à partir de weekStartDate si besoin
 * - clamp les champs planned
 * - répare dowIndex si incohérent
 * - garantit tuple 7 jours
 *
 * Renvoie null si trop cassé (id/weekStartDate/createdAt/source/days introuvables).
 */
export function normalizeWeeklyPlan(raw: unknown): WeeklyPlan | null {
  if (!isRecord(raw)) return null;

  const id = normStr((raw as any).id);
  const weekStartDate = (raw as any).weekStartDate;
  const weekLabel = typeof (raw as any).weekLabel === "string" ? (raw as any).weekLabel : "Semaine";
  const createdAt = (raw as any).createdAt;
  const source = (raw as any).source;

  if (!id) return null;
  if (!isISODate(weekStartDate)) return null;
  if (!isFiniteNumber(createdAt) || createdAt <= 0) return null;
  if (source !== "generated" && source !== "edited") return null;

  const daysRaw = Array.isArray((raw as any).days) ? (raw as any).days : null;
  if (!daysRaw || daysRaw.length < 1) return null;

  // on reconstruit 7 jours, indexés 0..6
  const outDays: WeeklyPlanDay[] = [];
  for (let i = 0; i < 7; i++) {
    const fallbackDate = addDaysISO(weekStartDate, i);
    const fallbackDow = i as DowIndex;

    const cand = daysRaw[i];

    // si le jour est "propre", on le prend, sinon fallback
    const safe = looksLikeWeeklyPlanDay(cand) ? (cand as WeeklyPlanDay) : null;

    const workout = safe && isWorkoutTypeRuntime((safe as any).workout) ? safe.workout : ("Repos" as WorkoutType);

    const details =
      safe && typeof safe.details === "string" ? safe.details : "—";

    const plannedDistanceKm = (() => {
      const v = safe ? (safe as any).plannedDistanceKm : undefined;
      if (v == null) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      return clamp(n, 0, 1000);
    })();

    const plannedDurationMin = (() => {
      const v = safe ? (safe as any).plannedDurationMin : undefined;
      if (v == null) return undefined;
      const n = Number(v);
      if (!Number.isFinite(n)) return undefined;
      return clamp(n, 0, 24 * 60);
    })();

    // date/dowIndex => on force la cohérence avec weekStartDate
    const date = fallbackDate;
    const dowIndex = fallbackDow;

    // IA fields: on garde si présents, sinon undefined
    const aiStamp = safe && isISODate((safe as any).aiStamp) ? (safe as any).aiStamp : undefined;
    const aiMode = safe ? (safe as any).aiMode : undefined;
    const aiConfidence = safe ? (safe as any).aiConfidence : undefined;

    const aiReasonsText = (() => {
      const rt = safe ? (safe as any).aiReasonsText : undefined;
      if (!Array.isArray(rt)) return undefined;
      const cleaned = rt.filter((x: any) => typeof x === "string").map((s: string) => s.trim()).filter(Boolean);
      return cleaned.length ? cleaned.slice(0, 4) : undefined;
    })();

    const aiReasons = safe ? (safe as any).aiReasons : undefined;
    const aiFallback = safe ? (safe as any).aiFallback : undefined;

    outDays.push({
      date,
      dowIndex,
      workout,
      details,
      plannedDistanceKm,
      plannedDurationMin,
      aiStamp,
      aiMode,
      aiConfidence,
      aiReasonsText,
      aiReasons,
      aiFallback,
    });
  }

  const days = outDays as unknown as WeeklyPlanDays;

  return {
    id,
    weekStartDate,
    weekLabel: normStr(weekLabel) || "Semaine",
    createdAt: Math.round(createdAt),
    source,
    fingerprint: typeof (raw as any).fingerprint === "string" ? (raw as any).fingerprint : undefined,
    days,
  };
}

/**
 * Assert utile si tu veux fail-fast en dev
 */
export function assertWeeklyPlan(raw: unknown): asserts raw is WeeklyPlan {
  if (!looksLikeWeeklyPlan(raw)) {
    const dbg = typeof raw === "object" ? JSON.stringify(raw).slice(0, 600) : String(raw);
    throw new Error(`Invalid WeeklyPlan payload: ${dbg}`);
  }
}

/* ------------------------------- constructors ------------------------------ */

export function makeEmptyWeeklyPlan(args?: {
  weekStartDate?: ISODate;
  weekLabel?: string;
  id?: string;
  source?: WeeklyPlanSource;
  /** workout par défaut (souvent "Repos") */
  defaultWorkout?: WorkoutType;
  /** details par défaut (souvent "—") */
  defaultDetails?: string;
}): WeeklyPlan {
  const start = args?.weekStartDate ?? weekStartISO(new Date());
  const id = normStr(args?.id) || `wp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const weekLabel = normStr(args?.weekLabel) || "Semaine";
  const defaultWorkout = (args?.defaultWorkout ?? "Repos") as WorkoutType;
  const defaultDetails = typeof args?.defaultDetails === "string" ? args!.defaultDetails : "—";

  const days = Array.from({ length: 7 }, (_, i) => {
    const dow = i as DowIndex;
    return {
      date: addDaysISO(start, i),
      dowIndex: dow,
      workout: defaultWorkout,
      details: defaultDetails,
    } satisfies WeeklyPlanDay;
  }) as unknown as WeeklyPlanDays;

  return {
    id,
    weekStartDate: start,
    weekLabel,
    createdAt: Date.now(),
    source: args?.source ?? "generated",
    days,
  };
}
