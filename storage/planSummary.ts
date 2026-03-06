// storage/planSummary.ts
import { ensureWeeklyPlan } from "@/coaching/planService";
import * as onboarding from "@/storage/onboarding";
import type { WeeklyPlan } from "@/storage/weeklyPlan";

export type PhaseKey =
  | "foundation"
  | "base"
  | "build"
  | "stabilisation"
  | "taper"
  | "race"
  | "recovery"
  | "unknown";

export type PlanSummary = {
  weekIndex: number; // 1..N
  phaseKey: PhaseKey;
  objectiveLabel: string;
};

/**
 * ⚠️ V1: on dérive week/phase/objectif depuis le plan + onboarding.
 * Plus tard tu pourras stocker ce PlanSummary explicitement dans une PlanStore.
 */
export async function getCurrentPlanSummary(): Promise<PlanSummary> {
  const [plan, onb] = await Promise.all([
    ensureWeeklyPlan().catch(() => null as WeeklyPlan | null),
    onboarding.loadOnboarding().catch(() => null as any),
  ]);

  const weekIndex = Number.isFinite((plan as any)?.meta?.weekIndex)
    ? Number((plan as any).meta.weekIndex)
    : 1;

  const phaseKey: PhaseKey =
    ((plan as any)?.meta?.phaseKey as PhaseKey) ?? "unknown";

  // Objectif : on préfère un label prêt à afficher si tu l’as déjà.
  const objectiveLabel =
    String(
      onb?.goal?.label ??
        onb?.goal?.objectiveLabel ??
        onb?.goal?.kindLabel ??
        onb?.objectiveLabel ??
        "Objectif en cours"
    ).trim() || "Objectif en cours";

  return { weekIndex, phaseKey, objectiveLabel };
}

export function phaseLabelFR(key: PhaseKey): string {
  switch (key) {
    case "foundation":
      return "Fondation";
    case "base":
      return "Base";
    case "build":
      return "Construction";
    case "stabilisation":
      return "Stabilisation";
    case "taper":
      return "Affûtage";
    case "race":
      return "Objectif";
    case "recovery":
      return "Récupération";
    default:
      return "Phase";
  }
}
