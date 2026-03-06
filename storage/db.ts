// storage/db.ts
import { listActivities } from "@/storage/activities";
import { ensureWeeklyPlan } from "@/coaching/planService";
import { buildLoadSeries, summarizeLoad } from "@/coaching/metrics";
import { generateCoachAdvice } from "@/storage/coach";

import type { Activity } from "@/storage/activities";
import type { WeeklyPlan } from "@/storage/weeklyPlan";

/**
 * Central loader:
 * - charge activities + weekly plan en parallèle
 * - calcule métriques (non bloquant)
 * - génère conseils coach (non bloquant)
 * - collecte warnings (debug / logs)
 */

export type LoadDBResult = {
  activities: Activity[];
  plan: WeeklyPlan | null;

  loadSeries: ReturnType<typeof buildLoadSeries> | null;
  loadSummary: ReturnType<typeof summarizeLoad> | null;

  coach: ReturnType<typeof generateCoachAdvice>;

  warnings: string[];
};

export type LoadDBOptions = {
  /** demande un refresh du plan (si supporté) */
  forceRefreshPlan?: boolean;

  /** collecte les warnings (true par défaut) */
  collectWarnings?: boolean;
};

/* -------------------------------- helpers -------------------------------- */

function safeStringify(x: unknown): string {
  try {
    if (typeof x === "string") return x;
    if (x instanceof Error) return x.message;
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function toWarning(prefix: string, err: unknown): string {
  return `${prefix}: ${safeStringify(err)}`;
}

/**
 * Chargement plan avec compat:
 * - tente ensureWeeklyPlan({force:true}) si demandé
 * - si ça échoue (signature incompatible), retente ensureWeeklyPlan() sans arg
 * - renvoie null si tout échoue
 */
async function loadPlan(force?: boolean): Promise<WeeklyPlan | null> {
  // 1) tentative avec arg si force
  if (force) {
    try {
      const fn = ensureWeeklyPlan as unknown as (arg?: { force?: boolean }) => Promise<WeeklyPlan>;
      return await fn({ force: true });
    } catch {
      // fallback sans arg
      try {
        const fn0 = ensureWeeklyPlan as unknown as () => Promise<WeeklyPlan>;
        return await fn0();
      } catch {
        return null;
      }
    }
  }

  // 2) appel normal
  try {
    const fn0 = ensureWeeklyPlan as unknown as () => Promise<WeeklyPlan>;
    return await fn0();
  } catch {
    // en dernier recours, certains impls acceptent un arg vide
    try {
      const fn = ensureWeeklyPlan as unknown as (arg?: any) => Promise<WeeklyPlan>;
      return await fn(undefined);
    } catch {
      return null;
    }
  }
}

/* ---------------------------------- main --------------------------------- */

export async function loadDB(options?: LoadDBOptions): Promise<LoadDBResult> {
  const collectWarnings = options?.collectWarnings ?? true;
  const warnings: string[] = [];

  // 1) activités + plan en parallèle
  const [actsRes, planRes] = await Promise.allSettled([
    listActivities(),
    loadPlan(options?.forceRefreshPlan),
  ]);

  const activities: Activity[] = actsRes.status === "fulfilled" ? actsRes.value : [];
  if (actsRes.status === "rejected" && collectWarnings) {
    warnings.push(toWarning("listActivities failed", actsRes.reason));
  }

  const plan: WeeklyPlan | null = planRes.status === "fulfilled" ? planRes.value : null;
  if (planRes.status === "rejected" && collectWarnings) {
    warnings.push(toWarning("ensureWeeklyPlan failed", planRes.reason));
  }

  // 2) métriques (jamais bloquant)
  let loadSeries: ReturnType<typeof buildLoadSeries> | null = null;
  let loadSummary: ReturnType<typeof summarizeLoad> | null = null;

  try {
    loadSeries = buildLoadSeries(activities);
    loadSummary = summarizeLoad(loadSeries);
  } catch (e) {
    if (collectWarnings) warnings.push(toWarning("metrics failed", e));
    loadSeries = null;
    loadSummary = null;
  }

  // 3) coach (jamais bloquant)
  let coach: ReturnType<typeof generateCoachAdvice>;
  try {
    coach = generateCoachAdvice(activities);
  } catch (e) {
    if (collectWarnings) warnings.push(toWarning("coach advice failed", e));
    coach = generateCoachAdvice([]);
  }

  return {
    activities,
    plan,
    loadSeries,
    loadSummary,
    coach,
    warnings,
  };
}
