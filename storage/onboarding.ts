// storage/onboarding.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { OnboardingSchema } from "./onboarding.schema";
import type {
  Onboarding,
  Profile,
  Program,
  Goal,
  Level,
  Sex,
  Sport,
  Injury,
  InjurySeverity,
  SessionsPerWeek,
} from "./onboarding.schema";

/**
 * V4 — stockage onboarding
 * - migration douce depuis v3/v2/v1
 * - mutex anti-race
 * - merge profond minimal (profile/program)
 * - normalisation via Zod (defaults + sanitation + cohérence)
 */

const KEY_V4 = "pacepilot:onboarding:v4";

const LEGACY_KEYS = [
  "pacepilot:onboarding:v3",
  "pacepilot:onboarding:v2",
  "pacepilot:onboarding:v1",
  "pacepilot:onboarding",
] as const;

export type {
  Onboarding,
  Profile,
  Program,
  Goal,
  Level,
  Sex,
  Sport,
  Injury,
  InjurySeverity,
  SessionsPerWeek,
};

/* ---------------------------------- utils --------------------------------- */

function nowISO(): string {
  return new Date().toISOString();
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

async function readJson(key: string): Promise<unknown | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function mergeOnboardingDeepMinimal(
  base: Partial<Onboarding>,
  patch: Partial<Onboarding>
): Partial<Onboarding> {
  const baseProfile = isObj(base.profile) ? (base.profile as Partial<Profile>) : {};
  const patchProfile = isObj(patch.profile) ? (patch.profile as Partial<Profile>) : {};

  const baseProgram = isObj(base.program) ? (base.program as Partial<Program>) : {};
  const patchProgram = isObj(patch.program) ? (patch.program as Partial<Program>) : {};

  return {
    ...base,
    ...patch,
    profile: { ...baseProfile, ...patchProfile } as Onboarding["profile"],
    program: { ...baseProgram, ...patchProgram } as Onboarding["program"],
  } as Partial<Onboarding>;
}

/* ------------------------------- mutex gate -------------------------------- */

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

/* ----------------------------- normalization -------------------------------- */

function normalizeOnboardingDraft(draft: Partial<Onboarding>): Onboarding {
  const now = nowISO();
  const createdAt = typeof draft.createdAt === "string" ? draft.createdAt : now;
  const updatedAt = now;

  const res = OnboardingSchema.safeParse({
    ...draft,
    createdAt,
    updatedAt,
  });

  if (res.success) return res.data;

  // fallback minimal sûr
  const fallback = OnboardingSchema.safeParse({ createdAt, updatedAt });
  return fallback.success
    ? fallback.data
    : ({ createdAt, updatedAt } as unknown as Onboarding);
}

/* ------------------------------ migration ---------------------------------- */

async function ensureMigratedToV4(): Promise<void> {
  const v4 = await AsyncStorage.getItem(KEY_V4);
  if (v4) return;

  for (const k of LEGACY_KEYS) {
    const raw = await readJson(k);
    if (!raw) continue;

    // 1) si l'ancien format passe déjà le schema v4 => parfait
    const parsed = OnboardingSchema.safeParse(raw);
    if (parsed.success) {
      await writeJson(KEY_V4, parsed.data);
      return;
    }

    // 2) sinon, si objet "proche", on tente normalisation permissive
    if (isObj(raw)) {
      const normalized = normalizeOnboardingDraft(raw as Partial<Onboarding>);
      await writeJson(KEY_V4, normalized);
      return;
    }
  }

  // rien trouvé => minimal
  const minimal = normalizeOnboardingDraft({});
  await writeJson(KEY_V4, minimal);
}

/* ---------------------------------- API ----------------------------------- */

export async function loadOnboarding(): Promise<Onboarding | null> {
  await ensureMigratedToV4();

  const parsed = await readJson(KEY_V4);
  if (!parsed) return null;

  const res = OnboardingSchema.safeParse(parsed);
  return res.success ? res.data : null;
}

/**
 * Sauvegarde robuste:
 * - mutex anti-race
 * - merge profond minimal
 * - normalisation via Zod (defaults, uniq/sort, timestamps)
 * - un patch invalide n’écrase jamais une donnée existante valide
 */
export async function saveOnboarding(patch: Partial<Onboarding>): Promise<Onboarding> {
  return withGate(async () => {
    await ensureMigratedToV4();

    const existing = (await loadOnboarding()) ?? null;
    const mergedDraft = mergeOnboardingDeepMinimal(existing ?? {}, patch);

    const normalized = (() => {
      const res = OnboardingSchema.safeParse({
        ...mergedDraft,
        createdAt: existing?.createdAt ?? (typeof mergedDraft.createdAt === "string" ? mergedDraft.createdAt : nowISO()),
        updatedAt: nowISO(),
      });
      return res.success ? res.data : null;
    })();

    if (!normalized) {
      if (existing) {
        await writeJson(KEY_V4, existing);
        return existing;
      }
      const minimal = normalizeOnboardingDraft({});
      await writeJson(KEY_V4, minimal);
      return minimal;
    }

    await writeJson(KEY_V4, normalized);
    return normalized;
  });
}

export async function clearOnboarding(): Promise<void> {
  await withGate(async () => {
    await AsyncStorage.removeItem(KEY_V4);
    for (const k of LEGACY_KEYS) {
      await AsyncStorage.removeItem(k);
    }
  });
}

/* ------------------------------- UI helpers -------------------------------- */

/**
 * Completeness "profil" (inscription)
 * On reste volontairement pragmatique:
 * - pour construire un coach cohérent, on veut au minimum:
 *   name, age, heightCm, weightKg, sex, level, sports >= 1
 * - blessures: optionnel (mais si présent, doit être valide via Zod déjà)
 */
export function isProfileComplete(data: Onboarding | null | undefined): boolean {
  const p = data?.profile;
  if (!p) return false;

  const okName = typeof p.name === "string" && p.name.trim().length >= 2;

  const okAge = typeof p.age === "number" && Number.isFinite(p.age) && p.age >= 10 && p.age <= 99;

  const okH =
    typeof p.heightCm === "number" &&
    Number.isFinite(p.heightCm) &&
    p.heightCm >= 120 &&
    p.heightCm <= 230;

  const okW =
    typeof p.weightKg === "number" &&
    Number.isFinite(p.weightKg) &&
    p.weightKg >= 30 &&
    p.weightKg <= 250;

  const okSex = typeof (p as any).sex === "string" && (p as any).sex.trim().length > 0;

  const okLevel = typeof (p as any).level === "string" && (p as any).level.trim().length > 0;

  const sports = (p as any).sports;
  const okSports = Array.isArray(sports) && sports.length >= 1;

  return okName && okAge && okH && okW && okSex && okLevel && okSports;
}

/**
 * Completeness "programme"
 * - sessionsPerWeek
 * - trainingDays
 * - allowMoveSessions + movableDays si allow=true
 * - calibrationSessionsCount est dérivé par le schema => toujours présent si program présent
 */
export function isProgramComplete(data: Onboarding | null | undefined): boolean {
  const pr = data?.program;
  if (!pr) return false;

  const spw = (pr as any).sessionsPerWeek;
  const okSpw = spw === 1 || spw === 2 || spw === 3 || spw === 4 || spw === 5 || spw === 6;

  const td = (pr as any).trainingDays;
  const okDays =
    Array.isArray(td) &&
    td.length >= 1 &&
    td.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6);

  const allowMove = Boolean((pr as any).allowMoveSessions);
  const md = (pr as any).movableDays;
  const okMove = !allowMove || (Array.isArray(md) && md.length >= 1 && md.every((d: any) => Number.isInteger(d) && d >= 0 && d <= 6));

  // goal/level optionnels au départ (tu les choisis après calibrage)
  return okSpw && okDays && okMove;
}

/**
 * Helpers pratiques (souvent utiles en UI)
 */
export function getCalibrationSessionsCount(data: Onboarding | null | undefined): number {
  const n = (data?.program as any)?.calibrationSessionsCount;
  return typeof n === "number" && Number.isFinite(n) ? Math.max(3, Math.min(6, Math.round(n))) : 3;
}

export function hasCompletedCalibration(data: Onboarding | null | undefined): boolean {
  // MVP: à brancher sur une vraie logique (compter activités "calibration" réalisées)
  // Ici on renvoie false par défaut.
  return false;
}

export const ONBOARDING_STORAGE_KEY = KEY_V4;
