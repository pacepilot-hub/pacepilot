// src/domain/trainingPlan.types.ts
import type { Goal, Level } from "./onboarding.schema";

/**
 * TrainingPlan (domaine)
 * - Immutable by default (Readonly) pour éviter les mutations accidentelles
 * - Dates en ISO 8601 (string) pour rester sérialisable (storage / API)
 */

export type IsoDateString = string;

export type TrainingPlanId = string;

export type TrainingPlan = Readonly<{
  planId: TrainingPlanId;
  goal: Goal;
  level: Level;

  /** Semaines ordonnées (weekIndex croissant) */
  weeks: ReadonlyArray<TrainingWeek>;

  /** Date de génération du plan (ISO 8601) */
  createdAt: IsoDateString;

  /** Version du générateur / format */
  version: number;
}>;

/* --------------------------------- weeks --------------------------------- */

export type TrainingWeek = Readonly<{
  weekIndex: number; // 1..N
  startDate: IsoDateString; // lundi (recommandé)
  label?: string; // ex: "Semaine 4 — Charge"
  phase?: string; // ex: "base" | "specifique" ...
  sessions: ReadonlyArray<TrainingSession>;
}>;

export type TrainingSession = Readonly<{
  sessionId: string;
  dayIndex: number; // 0..6 (Lun..Dim)
  kind: SessionKind;

  title: string; // ex: "EF" / "Fractionné" / "SL"
  description?: string; // détails lisibles (warmup/main/cooldown)
  target?: SessionTarget; // allures / zones / RPE
  durationMin?: number;
  distanceKm?: number;

  load?: number; // 0..200 (ou ton échelle)
  tags?: ReadonlyArray<string>;
}>;

export type SessionKind = "run" | "bike" | "strength" | "rest" | "mobility";

export type SessionTarget = Readonly<{
  label: string; // ex: "Seuil", "Z2", "EF"
  paceMinPerKm?: { from: string; to: string }; // "4:35".."4:45"
  hrZone?: number; // 1..5
  rpe?: number; // 1..10
}>;
