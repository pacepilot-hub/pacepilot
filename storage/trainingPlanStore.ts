// storage/trainingPlan.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * ✅ TrainingPlan storage (v1) — Beta-ready
 * - Versioning (clé versionnée) + stub migration
 * - Anti-race (mutex gate)
 * - Parse safe + sanitize strict (ne lit jamais du “sale”)
 * - Auto-réparation (tri sessions, recalcul totalKm si manquant)
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
  totalKm: number; // 0..1000 (week)
  sessions: Session[]; // >= 1
}>;

export type TrainingPlan = Readonly<{
  planId: string;
  goal: string;
  level: string;
  weeks: TrainingWeek[]; // >= 1
  createdAt: string; // ISO
  version: number; // >= 1
}>;

/* ----------------------------- storage config ----------------------------- */

// ⚠️ Bump si structure change et tu veux forcer regen / migration
const STORAGE = {
  namespace: "pacepilot:trainingPlan",
  version: 1,
  key() {
    return `${this.namespace}:v${this.version}`;
  },
} as const;

export const TRAINING_PLAN_STORAGE_KEY = STORAGE.key();

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
  return x === "EASY" || x === "THRESHOLD" || x === "LONG" || x === "TEMPO" || x === "INTERVAL" || x === "RECOVERY";
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

  // semaine sans séances -> refuse (un plan vide ne sert à rien)
  if (sessions.length === 0) return null;

  // tri stable: dayOfWeek
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

  // tri stable: weekIndex croissant
  weeks.sort((a, b) => a.weekIndex - b.weekIndex);

  // dédoublonnage: same weekIndex -> garde la première
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

async function tryMigrateFromOlderVersions(): Promise<TrainingPlan | null> {
  // Exemple futur (si STORAGE.version passe à 2):
  // const rawV1 = await AsyncStorage.getItem(`${STORAGE.namespace}:v1`);
  // if (rawV1) { ...convert...; await saveTrainingPlan(converted); return converted; }
  return null;
}

/* ---------------------------------- API ---------------------------------- */

export async function saveTrainingPlan(plan: TrainingPlan): Promise<void> {
  const key = STORAGE.key();

  return withGate(async () => {
    // sanitize avant d'écrire
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
  const key = STORAGE.key();

  return withGate(async () => {
    try {
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return await tryMigrateFromOlderVersions();

      const parsed = safeJsonParse(raw);
      if (!parsed) return null;

      const sanitized = sanitizeTrainingPlan(parsed);
      if (!sanitized) return null;

      // auto-réparation: réécrit si on a normalisé (tri/dedup/totalKm)
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
  const key = STORAGE.key();
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
  KEY: STORAGE.key(),
  VERSION: STORAGE.version,
} as const;

export default TrainingPlanStorage;

/* --------------------------- optional conveniences -------------------------- */

/** Crée un squelette minimal safe (utile si tu veux init rapidement) */
export function makeEmptyTrainingPlan(input: { goal: string; level: string; planId?: string }): TrainingPlan {
  const now = isoNow();
  return {
    planId: normStr(input.planId) || `plan_${Date.now()}`,
    goal: normStr(input.goal) || "Unknown",
    level: normStr(input.level) || "Unknown",
    weeks: [],
    createdAt: now,
    version: STORAGE.version,
  };
}
