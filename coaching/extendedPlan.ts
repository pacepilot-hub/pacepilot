// coaching/extendedPlan.ts

/**
 * Extended plan model (MVP+)
 * Objectifs:
 * - types plus stricts (ids/keys), mais tolérants (goal/level restent string)
 * - prêt pour timeline UI (weekStart/weekEnd) et deload/targetLoad
 * - rétro-compat: weekIndex/weekLabel restent obligatoires
 */

/* --------------------------------- helpers -------------------------------- */

export type ISODate = `${number}-${number}-${number}`; // "YYYY-MM-DD" (validation runtime ailleurs)

/** 0..100 (validation runtime ailleurs) */
export type LoadScore = number;

/** Branded helpers (optionnels mais pratiques pour éviter les confusions) */
type Brand<T, B extends string> = T & { __brand?: B };
export type WeekIndex = Brand<number, "WeekIndex">;

/* ---------------------------------- ids ---------------------------------- */

export type PhaseId = "base" | "build" | "peak" | "taper" | "recovery" | "custom";

/* --------------------------------- models -------------------------------- */

export type WeekItem = {
  /** 1..N (index humain) */
  weekIndex: number; // garde simple en runtime, brand possible au besoin
  /** "Semaine 3" / "Semaine 4 • allégée" */
  weekLabel: string;

  /** optionnel: utile pour UI (timeline) */
  weekStart?: ISODate; // YYYY-MM-DD (local)
  weekEnd?: ISODate;   // YYYY-MM-DD (local)

  /** optionnel: deload, target load, etc */
  isDeload?: boolean;

  /**
   * 0..100
   * - "target load" UI/IA (charge souhaitée) : pas une vérité absolue
   */
  targetLoad?: LoadScore;

  /** notes UI (ex: "priorité récup", "enchaînement") */
  note?: string;

  /** tags libres (ex: ["volume","endurance","spécifique"]) */
  tags?: string[];
};

export type PlanPhase = {
  /**
   * id stable pour navigation / filtres
   * - PhaseId connu ou string si IA/custom
   */
  id: PhaseId | string;

  /** libellé UI (FR) */
  label: string;

  /** décrit l’objectif de la phase (ex: "volume", "spécifique") */
  objective?: string;

  /** dates phase (optionnel) */
  startDate?: ISODate;
  endDate?: ISODate;

  /** semaines de la phase (obligatoire) */
  weeks: WeekItem[];

  /** notes UI */
  note?: string;
};

export type ExtendedPlan = {
  /**
   * ex: "10k" | "half" | "marathon" | "custom"
   * On laisse string pour MVP (interop API / migrations)
   */
  goal: string;

  /**
   * ex: "beginner" | "regular" | "advanced"
   * On laisse string pour MVP
   */
  level: string;

  /** date de départ du plan (optionnel) */
  startDate?: ISODate;

  /** date objectif (optionnel) */
  goalDate?: ISODate;

  /** versioning pour migrations */
  planVersion?: string;

  /** phases du plan */
  phases: PlanPhase[];

  /** meta libre (ex: algoVersion, seed, etc.) */
  meta?: Record<string, unknown>;
};
