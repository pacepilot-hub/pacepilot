// coaching/routeGenerator.ts

export type WorkoutType = "ef" | "sl" | "seuil" | "cotes" | "trail";

export type WorkoutSpec = {
  type: WorkoutType;
  durationMin?: number;
  distanceKm?: number;
  label?: string;
};

export type ProfileKey = "foot-walking" | "foot-hiking";

export type RouteCriteria = {
  targetKm: number;       // distance cible
  tolerancePct: number;   // ±0.08 => ±8%
  profile: ProfileKey;    // route vs trail
  candidates: number;     // nb de propositions
  loop: boolean;          // boucle ou aller simple
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function safeNum(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Convertit une séance en critères par défaut.
 * - Si distance connue => base = distance
 * - Sinon durée => base = estimation simple (≈ 6'00/km) => duration/6
 * - Ajuste profil selon trail
 */
export function criteriaFromWorkout(
  workout: WorkoutSpec,
  overrides?: Partial<RouteCriteria>
): RouteCriteria {
  const dur = safeNum(workout.durationMin);
  const dist = safeNum(workout.distanceKm);

  const baseTarget =
    dist != null ? clamp(dist, 2, 60) :
    dur != null ? clamp(Math.round(dur / 6), 2, 60) :
    10;

  const base: RouteCriteria = {
    targetKm: baseTarget,
    tolerancePct: 0.08,
    profile: workout.type === "trail" ? "foot-hiking" : "foot-walking",
    candidates: 12,
    loop: true,
  };

  const merged: RouteCriteria = { ...base, ...(overrides ?? {}) };

  // garde-fous
  merged.targetKm = clamp(merged.targetKm, 2, 60);
  merged.tolerancePct = clamp(merged.tolerancePct, 0.03, 0.25);
  merged.candidates = clamp(Math.round(merged.candidates), 3, 30);
  merged.loop = !!merged.loop;
  merged.profile = merged.profile === "foot-hiking" ? "foot-hiking" : "foot-walking";

  return merged;
}
