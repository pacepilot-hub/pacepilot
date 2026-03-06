// storage/trainingPlan.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE as STORAGE_KEYS } from "@/storage/constants";

/**
 * ✅ TrainingPlan storage — Beta-ready
 * - Versioning via STORAGE_KEYS.trainingPlan
 * - Anti-race (mutex gate)
 * - Parse safe + sanitize strict
 * - Auto-réparation (tri sessions, totalKm recalculé, tri/dedup weeks)
 * - N’écrit jamais un payload invalide
 */

/* --------------------------------- types --------------------------------- */

export type Intensity = "EASY" | "THRESHOLD" | "LONG" | "TEMPO" | "INTERVAL" | "RECOVERY";

export type Session = Readonly<{
  dayOfWeek: number; // 0..6
  label: string;
  intensity: Intensity;
  distanceKm?: number; // 0..1000
  durationMin?: number; // 0..1440
  notes?: string;
}>;

export type TrainingWeek = Readonly<{
  weekIndex: number; // 1..N
  focus: "Base" | "Spécifique" | "Taper";
  totalKm: number; // 0..1000
  sessions: ReadonlyArray<Session>; // >= 1
}>;

export type TrainingPlan = Readonly<{
  planId: string;
  goal: string;
  level: string;
  weeks: ReadonlyArray<TrainingWeek>; // >= 1
  createdAt: string; // ISO
  version: number; // >= 1
}>;

/* ----------------------------- storage config ----------------------------- */

const STORAGE_PLAN = {
  version: STORAGE_KEYS.trainingPlan.currentVersion,
  key(v = STORAGE_KEYS.trainingPlan.currentVersion) {
    return STORAGE_KEYS.trainingPlan.key(v);
  },
} as const;

export const TRAINING_PLAN_STORAGE_KEY = STORAGE_PLAN.key();

/* --------------------------------- helpers -------------------------------- */

function isoNow(): string {
  return new Date().toISOString();
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function normStr(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function safeNum(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function clampInt(x: unknown, min: number, max: number, fallback: number) {
  const n = safeNum(x);
  if (n === undefined) return fallback;
  return clamp(Math.round(n), min, max);
}

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isValidIsoDateString(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const d = new Date(s);
  return Number.isFinite(d.getTime());
}

function isValidIntensity(x: unknown): x is Intensity {
  return (
    x === "EASY" ||
    x === "THRESHOLD" ||
    x === "LONG" ||
    x === "TEMPO" ||
    x === "INTERVAL" ||
    x === "RECOVERY"
  );
}

function isValidFocus(x: unknown): x is TrainingWeek["focus"] {
  return x === "Base" || x === "Spécifique" || x === "Taper";
}

/* ------------------------------ sanitize logic ---------------------------- */

function sanitizeSession(x: unknown): Session | null {
  if (!isObj(x)) return null;

  const dayOfWeek = clampInt((x as any).dayOfWeek, 0, 6, -1);
  if (dayOfWeek < 0) return null;

  const label = normStr((x as any).label);
  if (!label) return null;

  const intensity = (x as any).intensity;
  if (!isValidIntensity(intensity)) return null;

  const distanceKmRaw = safeNum((x as any).distanceKm);
  const durationMinRaw = safeNum((x as any).durationMin);

  const distanceKm = distanceKmRaw === undefined ? undefined : clamp(distanceKmRaw, 0, 1000);
  const durationMin = durationMinRaw === undefined ? undefined : clamp(durationMinRaw, 0, 24 * 60);

  const notes =
    (x as any).notes == null
      ? undefined
      : typeof (x as any).notes === "string"
        ? (x as any).notes.trim() || undefined
        : undefined;

  return { dayOfWeek, label, intensity, distanceKm, durationMin, notes };
}

function sanitizeWeek(x: unknown): TrainingWeek | null {
  if (!isObj(x)) return null;

  const weekIndex = clampInt((x as any).weekIndex, 1, 1000, -1);
  if (weekIndex < 1) return null;

  const focus = (x as any).focus;
  if (!isValidFocus(focus)) return null;

  const totalKmRaw = safeNum((x as any).totalKm);
  const totalKm0 = totalKmRaw === undefined ? 0 : clamp(totalKmRaw, 0, 1000);

  const sessionsRaw = Array.isArray((x as any).sessions) ? (x as any).sessions : [];
  const sessions: Session[] = [];

  for (const s of sessionsRaw) {
    const ss = sanitizeSession(s);
    if (ss) sessions.push(ss);
  }

  // semaine vide -> refuse
  if (sessions.length === 0) return null;

  // tri stable par dayOfWeek
  sessions.sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  // répare totalKm si absent/0 et qu'on a des distances
  const sumDistance = sessions.reduce((acc, s) => acc + (s.distanceKm ?? 0), 0);
  const totalKm = totalKm0 > 0 ? totalKm0 : sumDistance > 0 ? clamp(sumDistance, 0, 1000) : 0;

  return { weekIndex, focus, totalKm, sessions };
}

function sanitizeTrainingPlan(x: unknown): TrainingPlan | null {
  if (!isObj(x)) return null;

  const planId = normStr((x as any).planId);
  const goal = normStr((x as any).goal);
  const level = normStr((x as any).level);
  const createdAt = (x as any).createdAt;

  const versionRaw = safeNum((x as any).version);
  const version = versionRaw === undefined ? NaN : Math.round(versionRaw);

  if (!planId) return null;
  if (!goal) return null;
  if (!level) return null;
  if (!isValidIsoDateString(createdAt)) return null;
  if (!Number.isFinite(version) || version < 1) return null;

  const weeksRaw = Array.isArray((x as any).weeks) ? (x as any).weeks : [];
  const weeks: TrainingWeek[] = [];

  for (const w of weeksRaw) {
    const ww = sanitizeWeek(w);
    if (ww) weeks.push(ww);
  }

  if (weeks.length === 0) return null;

  // tri stable weekIndex croissant
  weeks.sort((a, b) => a.weekIndex - b.weekIndex);

  // dedup weekIndex (garde la 1ère)
  const dedup: TrainingWeek[] = [];
  const seen = new Set<number>();
  for (const w of weeks) {
    if (seen.has(w.weekIndex)) continue;
    seen.add(w.weekIndex);
    dedup.push(w);
  }

  return { planId, goal, level, weeks: dedup, createdAt, version };
}

/* ------------------------------- gate (mutex) ------------------------------ */

let gate: Promise<void> | null = null;

async function withGate<T>(fn: () => Promise<T>): Promise<T> {
  while (gate) await gate;
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  try {
    return await fn();
  } finally {
    release();
    gate = null;
  }
}

/* ----------------------------- migration hook ----------------------------- */

/**
 * Migration générique:
 * - Si un jour tu bump version (ex v2), on cherchera v1, puis on réécrira en v2 si possible.
 * - Pour v1 => ne fait rien.
 */
async function tryMigrateFromOlderVersions(): Promise<TrainingPlan | null> {
  const currentV = STORAGE_PLAN.version;
  if (currentV <= 1) return null;

  // cherche v(currentV-1 .. 1)
  for (let v = currentV - 1; v >= 1; v--) {
    const k = STORAGE_PLAN.key(v);
    const raw = await AsyncStorage.getItem(k);
    if (!raw) continue;

    const parsed = safeJsonParse(raw);
    if (!parsed) continue;

    const sanitized = sanitizeTrainingPlan(parsed);
    if (!sanitized) continue;

    // convert simple: on garde la structure si compatible, et on bump version
    const converted: TrainingPlan = { ...sanitized, version: currentV };

    // réécrit sous la clé courante
    await AsyncStorage.setItem(STORAGE_PLAN.key(), JSON.stringify(converted));
    return converted;
  }

  return null;
}

/* ---------------------------------- API ---------------------------------- */

export async function saveTrainingPlan(plan: TrainingPlan): Promise<void> {
  const key = STORAGE_PLAN.key();

  return withGate(async () => {
    const sanitized = sanitizeTrainingPlan(plan);
    if (!sanitized) throw new Error("Invalid training plan payload.");

    try {
      await AsyncStorage.setItem(key, JSON.stringify(sanitized));
    } catch {
      throw new Error("Failed to save training plan");
    }
  });
}

export async function loadTrainingPlan(): Promise<TrainingPlan | null> {
  const key = STORAGE_PLAN.key();

  return withGate(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return await tryMigrateFromOlderVersions();

      const parsed = safeJsonParse(raw);
      if (!parsed) return null;

      const sanitized = sanitizeTrainingPlan(parsed);
      if (!sanitized) return null;

      // auto-réparation: réécrit si on a normalisé
      const reRaw = JSON.stringify(sanitized);
      if (reRaw !== raw) {
        await AsyncStorage.setItem(key, reRaw);
      }

      return sanitized;
    } catch {
      return null;
    }
  });
}

export async function clearTrainingPlan(): Promise<void> {
  const key = STORAGE_PLAN.key();
  return withGate(async () => {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // noop
    }
  });
}

/**
 * ✅ Compat : certains imports utilisent TrainingPlanStorage.loadTrainingPlan(...)
 */
export const TrainingPlanStorage = {
  saveTrainingPlan,
  loadTrainingPlan,
  clearTrainingPlan,
  KEY: STORAGE_PLAN.key(),
  VERSION: STORAGE_PLAN.version,
} as const;

export default TrainingPlanStorage;

/* --------------------------- optional conveniences -------------------------- */

/**
 * Plan minimal VALID (weeks >= 1, sessions >= 1)
 * - Utile pour initialiser sans te faire rejeter par sanitizeTrainingPlan()
 */
export function makeEmptyTrainingPlan(input: { goal: string; level: string; planId?: string }): TrainingPlan {
  const now = isoNow();
  const planId = normStr(input.planId) || `plan_${Date.now()}`;
  const goal = normStr(input.goal) || "Unknown";
  const level = normStr(input.level) || "Unknown";

  const w1: TrainingWeek = {
    weekIndex: 1,
    focus: "Base",
    totalKm: 0,
    sessions: [
      {
        dayOfWeek: 0,
        label: "Repos",
        intensity: "RECOVERY",
        notes: "Plan initial",
      },
    ],
  };

  return {
    planId,
    goal,
    level,
    weeks: [w1],
    createdAt: now,
    version: STORAGE_PLAN.version,
  };
}
