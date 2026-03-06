// storage/plans.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WeeklyPlan } from "./weeklyPlan";

/**
 * ✅ WeeklyPlan storage — V2 (beta-ready)
 * Objectifs:
 * - clé versionnée + migration douce
 * - mutex anti-race (get/save/migrate)
 * - validation light + sanitation défensive
 * - API stable: get/save/clear/clearAllVersions
 *
 * ⚠️ IMPORTANT:
 * - Bump VERSION quand WeeklyPlan change
 * - La validation ici est "light" (anti-corruption), pas du Zod.
 */

const STORAGE = {
  key: "pacepilot.weeklyPlan",
  version: 2, // ✅ bump si WeeklyPlan a évolué / pour forcer migration
  fullKey(v = STORAGE.version) {
    return `${this.key}.v${v}`;
  },
} as const;

export const WEEKLY_PLAN_STORAGE_KEY = STORAGE.fullKey();

/* --------------------------------- helpers -------------------------------- */

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * Validation "light" (anti-corruption) alignée sur ton type WeeklyPlan:
 * - id string
 * - weekStartDate "YYYY-MM-DD"
 * - weekLabel string
 * - createdAt number
 * - source "generated" | "edited"
 * - days array (idéalement 7), on reste tolérant mais défensif.
 */
function looksLikeWeeklyPlan(x: unknown): x is WeeklyPlan {
  if (!isObj(x)) return false;
  const p: any = x;

  if (!isNonEmptyString(p.id)) return false;
  if (!isNonEmptyString(p.weekStartDate) || !isYmd(p.weekStartDate)) return false;
  if (!isNonEmptyString(p.weekLabel)) return false;

  if (typeof p.createdAt !== "number" || !Number.isFinite(p.createdAt)) return false;
  if (p.source !== "generated" && p.source !== "edited") return false;

  if (!Array.isArray(p.days)) return false;
  if (p.days.length < 1 || p.days.length > 14) return false; // tolérant, mais pas n'importe quoi

  // check light des days
  for (const d of p.days) {
    if (!isObj(d)) return false;
    const day: any = d;
    if (!isNonEmptyString(day.date) || !isYmd(day.date)) return false;
    if (typeof day.dowIndex !== "number" || !Number.isInteger(day.dowIndex) || day.dowIndex < 0 || day.dowIndex > 6) return false;
    if (!isNonEmptyString(day.workout)) return false;
    if (typeof day.details !== "string") return false;
  }

  return true;
}

/**
 * Sanitize défensif:
 * - garde uniquement les 7 jours de la semaine si possible
 * - trie par date si besoin
 * - nettoie des champs optionnels douteux
 *
 * ⚠️ On évite toute logique métier ici (pas d'IA).
 */
function sanitizeWeeklyPlan(plan: WeeklyPlan): WeeklyPlan {
  const p: any = plan;
  const out: any = { ...p };

  // days: objets only + clamp
  if (Array.isArray(out.days)) {
    out.days = out.days.filter((d: any) => d && typeof d === "object").slice(0, 14);

    // tentative: trier par date (YYYY-MM-DD => tri lexical OK)
    out.days.sort((a: any, b: any) => {
      const da = typeof a?.date === "string" ? a.date : "";
      const db = typeof b?.date === "string" ? b.date : "";
      if (da !== db) return da < db ? -1 : 1;
      return (a?.dowIndex ?? 0) - (b?.dowIndex ?? 0);
    });

    // si on a plus de 7 jours, on préfère garder 7 (beta: weekly plan)
    if (out.days.length > 7) out.days = out.days.slice(0, 7);
  } else {
    out.days = [];
  }

  // Clamp createdAt (raisonnable)
  if (typeof out.createdAt !== "number" || !Number.isFinite(out.createdAt)) out.createdAt = Date.now();

  // Normalize source
  if (out.source !== "generated" && out.source !== "edited") out.source = "generated";

  // weekStartDate fallback: si invalide, tente depuis days[0]
  if (!isNonEmptyString(out.weekStartDate) || !isYmd(out.weekStartDate)) {
    const firstDate = typeof out.days?.[0]?.date === "string" ? out.days[0].date : null;
    out.weekStartDate = firstDate && isYmd(firstDate) ? firstDate : "1970-01-01";
  }

  // weekLabel fallback
  if (!isNonEmptyString(out.weekLabel)) out.weekLabel = "Semaine";

  // fingerprint optionnel: si pas string -> remove
  if (out.fingerprint != null && typeof out.fingerprint !== "string") delete out.fingerprint;

  return out as WeeklyPlan;
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

/* ------------------------------ migration ---------------------------------- */

function candidateKeys(): string[] {
  const keys: string[] = [];
  for (let v = STORAGE.version; v >= 1; v--) keys.push(STORAGE.fullKey(v));
  return keys;
}

async function ensureMigratedToCurrent(): Promise<void> {
  const currentKey = STORAGE.fullKey();

  // déjà présent -> ok
  const exists = await AsyncStorage.getItem(currentKey);
  if (exists) return;

  // cherche la version la plus récente disponible
  for (const k of candidateKeys()) {
    const raw = await AsyncStorage.getItem(k);
    if (!raw) continue;

    const parsed = safeJsonParse(raw);
    if (!parsed || !looksLikeWeeklyPlan(parsed)) continue;

    const sanitized = sanitizeWeeklyPlan(parsed as WeeklyPlan);
    await AsyncStorage.setItem(currentKey, JSON.stringify(sanitized));
    return;
  }

  // rien à migrer: on ne crée pas de plan fantôme
}

/* ---------------------------------- API ---------------------------------- */

export async function getWeeklyPlan(): Promise<WeeklyPlan | null> {
  return withGate(async () => {
    try {
      await ensureMigratedToCurrent();

      const key = STORAGE.fullKey();
      const raw = await AsyncStorage.getItem(key);
      if (!raw) return null;

      const parsed = safeJsonParse(raw);
      if (!parsed || !looksLikeWeeklyPlan(parsed)) return null;

      const sanitized = sanitizeWeeklyPlan(parsed as WeeklyPlan);

      // réécrit si sanitize change le payload (cheap compare)
      const reRaw = JSON.stringify(sanitized);
      if (reRaw !== raw) await AsyncStorage.setItem(key, reRaw);

      return sanitized;
    } catch {
      return null;
    }
  });
}

export async function saveWeeklyPlan(plan: WeeklyPlan): Promise<void> {
  return withGate(async () => {
    await ensureMigratedToCurrent();

    const key = STORAGE.fullKey();
    const sanitized = sanitizeWeeklyPlan(plan);

    // on refuse de sauvegarder un plan manifestement invalide
    if (!looksLikeWeeklyPlan(sanitized)) {
      throw new Error("Invalid weekly plan payload");
    }

    try {
      await AsyncStorage.setItem(key, JSON.stringify(sanitized));
    } catch {
      throw new Error("Failed to save weekly plan");
    }
  });
}

export async function clearWeeklyPlan(): Promise<void> {
  return withGate(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE.fullKey());
    } catch {
      // noop
    }
  });
}

/**
 * Dev/debug: supprime toutes les versions connues (v1..vCURRENT)
 */
export async function clearAllWeeklyPlanVersions(): Promise<void> {
  return withGate(async () => {
    try {
      await AsyncStorage.multiRemove(candidateKeys());
    } catch {
      // noop
    }
  });
}
