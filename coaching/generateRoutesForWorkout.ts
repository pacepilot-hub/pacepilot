// coaching/generateRoutesForWorkout.ts
import type { Route, RouteTag, LatLngPoint } from "@/storage/routes";

/**
 * Générateur V1 "offline" (sans ORS) — refonte
 * - 3 propositions: simple / équilibrée / adaptée séance
 * - chacune essaie de coller à la cible (distance ou durée) via un scale auto-ajusté
 * - scoring + explications prêtes pour l’UI
 *
 * ⚠️ Pas de routing réel : c’est un fallback UX (géométrique).
 */

/* --------------------------------- types --------------------------------- */

export type WorkoutType = "ef" | "seuil" | "cotes" | "sl" | "trail" | "rest";

export type WorkoutSpec = {
  type: WorkoutType;
  title: string; // ex "Sortie longue — 1h20"
  targetTimeMin?: number; // ex 80
  targetDistanceKm?: number; // ex 12
  targetElevationGainM?: number; // ex 200
  targetPaceLabel?: string; // ex "EF"
  workoutKey: string; // ex "2026-01-26:SL"
};

export type GeneratorInput = {
  start: { lat: number; lng: number };
  workout: WorkoutSpec;
};

export type ScoredRoute = Route & {
  score: number; // 0..100
  why: string[];
  meta: {
    targetKm: number | null;
    targetMin: number | null;
    targetDplus: number | null;
    kmErr: number;
    minErr: number;
    dErr: number;
    usedPace: number; // min/km
    usedScale: number; // scale final
  };
};

/* -------------------------------- utils --------------------------------- */

function nowMs() {
  return Date.now();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

function safeNum(x: unknown): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function makeId(workoutKey: string, createdAt: number, idx: number) {
  // déterministe, pas de random (utile pour debug / tests)
  const base = `${workoutKey}|${createdAt}|${idx}`;
  // hash simple (non crypto) -> string courte
  let h = 2166136261;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `ai_${(h >>> 0).toString(16)}_${idx}`;
}

function toRad(x: number) {
  return (x * Math.PI) / 180;
}

// Haversine (km)
function distanceKm(points: LatLngPoint[]): number {
  if (points.length < 2) return 0;
  const R = 6371;

  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    sum += 2 * R * Math.asin(Math.sqrt(h));
  }
  return sum;
}

/**
 * Base de vitesse (min/km) — estimation grossière
 * (plus lent = nombre plus grand)
 */
function defaultPaceMinPerKm(type: WorkoutType): number {
  switch (type) {
    case "seuil":
      return 5.0;
    case "ef":
      return 5.8;
    case "sl":
      return 6.0;
    case "cotes":
      return 6.6; // inclut récup
    case "trail":
      return 6.9;
    case "rest":
    default:
      return 6.0;
  }
}

function tagsFor(type: WorkoutType): RouteTag[] {
  switch (type) {
    case "trail":
      return ["trail"];
    case "sl":
      return ["sl"];
    case "cotes":
      return ["cotes"];
    case "seuil":
      return ["seuil"];
    case "ef":
    default:
      return ["ef"];
  }
}

/**
 * Boucle “géométrique” autour du départ.
 * - 7 points + retour départ
 * - scale = taille
 * - mode = forme
 */
function makeLoop(
  start: { lat: number; lng: number },
  scale: number,
  mode: "simple" | "balanced" | "workout"
): LatLngPoint[] {
  const { lat, lng } = start;

  // variations selon mode (diversité)
  const k = mode === "simple" ? 1.0 : mode === "balanced" ? 1.16 : 1.28;

  const a = 0.0027 * scale * k;
  const b = 0.0019 * scale * k;
  const c = 0.0038 * scale * k;

  return [
    { lat, lng },
    { lat: lat + a, lng: lng + b },
    { lat: lat + c, lng: lng + 0.0004 * scale * k },
    { lat: lat + 0.0021 * scale * k, lng: lng - c * 0.55 },
    { lat: lat - 0.0006 * scale * k, lng: lng - b * 1.35 },
    { lat: lat - 0.0018 * scale * k, lng: lng + 0.0007 * scale * k },
    { lat, lng },
  ];
}

/**
 * D+ simulé
 * - trail/côtes => plus de D+
 * - seuil => plutôt plat
 */
function estimateDplus(workout: WorkoutSpec, km: number, scale: number): number {
  const base =
    workout.type === "trail"
      ? 220
      : workout.type === "cotes"
      ? 190
      : workout.type === "seuil"
      ? 55
      : 90;

  const target = safeNum(workout.targetElevationGainM);

  // si cible fournie, on "colle" avec une marge
  if (target && target > 0) {
    // on mixe target + base dépendant du km et scale (sinon cible énorme sur petit loop)
    const ref = base * scale * (0.8 + 0.25 * clamp(km / 10, 0.3, 1.8));
    const blended = 0.62 * target + 0.38 * ref;
    return Math.round(clamp(blended, 0, 8000));
  }

  // sans cible : dépend de km (sinon petit loop peut sortir trop de D+)
  const d = base * scale * (0.75 + 0.22 * clamp(km / 10, 0.25, 2.0));
  return Math.round(clamp(d, 0, 8000));
}

function targetKmFromWorkout(w: WorkoutSpec, paceMinPerKm: number): number | null {
  const dist = safeNum(w.targetDistanceKm);
  if (dist && dist > 0) return dist;

  const t = safeNum(w.targetTimeMin);
  if (t && t > 0) return t / paceMinPerKm;

  return null;
}

function targetMinFromWorkout(w: WorkoutSpec, paceMinPerKm: number): number | null {
  const t = safeNum(w.targetTimeMin);
  if (t && t > 0) return t;

  const dist = safeNum(w.targetDistanceKm);
  if (dist && dist > 0) return Math.round(dist * paceMinPerKm);

  return null;
}

/**
 * Ajuste le scale pour coller à targetKm (approx).
 * - on fait une petite recherche (binaire) sur scale
 * - comme le haversine dépend de la latitude, c’est mieux qu’une règle fixe.
 */
function findScaleForTargetKm(params: {
  start: { lat: number; lng: number };
  targetKm: number;
  mode: "simple" | "balanced" | "workout";
}): number {
  const { start, targetKm, mode } = params;

  // garde-fous
  const t = clamp(targetKm, 1.5, 60);

  // bornes scale (empirique)
  let lo = 0.35;
  let hi = 6.5;

  // si très court, on baisse hi
  if (t < 4) hi = 2.2;
  if (t > 25) lo = 1.2;

  // 10-14 itérations -> suffisant
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const pts = makeLoop(start, mid, mode);
    const km = distanceKm(pts);

    if (km < t) lo = mid;
    else hi = mid;
  }

  return clamp((lo + hi) / 2, 0.3, 7.0);
}

/**
 * Scoring (0..100)
 * - distance proche cible
 * - durée proche cible
 * - D+ proche cible (si cible) sinon cohérence type
 */
function scoreRoute(params: {
  km: number;
  estMin: number;
  dplus: number;
  w: WorkoutSpec;
  pace: number;
}): { score: number; why: string[]; meta: Omit<ScoredRoute["meta"], "usedScale"> } {
  const { km, estMin, dplus, w, pace } = params;

  const tKm = targetKmFromWorkout(w, pace);
  const tMin = targetMinFromWorkout(w, pace);
  const tD = safeNum(w.targetElevationGainM);

  const kmErr = tKm ? Math.abs(km - tKm) : 0;
  const minErr = tMin ? Math.abs(estMin - tMin) : 0;
  const dErr = tD ? Math.abs(dplus - tD) : 0;

  let score = 100;

  // distance (plus important)
  if (tKm) score -= kmErr * 16; // 1 km = -16
  // durée
  if (tMin) score -= (minErr / 5) * 7; // 5 min = -7
  // D+
  if (tD) score -= dErr * 0.065; // 100 m = -6.5

  // cohérence type (si pas de cible D+)
  if (!tD) {
    if (w.type === "seuil") score += dplus < 120 ? 10 : -12;
    else if (w.type === "ef") score += dplus < 180 ? 8 : -8;
    else if (w.type === "sl") score += dplus < 240 ? 6 : -6;
    else if (w.type === "cotes") score += Math.min(16, dplus / 22);
    else if (w.type === "trail") score += Math.min(18, dplus / 20);
  }

  if (w.type === "rest") score = 0;

  score = clamp(Math.round(score), 0, 100);

  const why: string[] = [];

  // bloc “objectif”
  if (tKm) why.push(`Cible ~${round1(tKm)} km → proposé ${round1(km)} km`);
  else why.push(`Distance ~${round1(km)} km`);

  if (tMin) why.push(`Cible ~${tMin} min → estimé ${estMin} min`);
  else why.push(`Durée estimée ~${estMin} min`);

  if (w.type === "seuil") why.push(dplus < 120 ? "Relief limité → plus simple de tenir l’allure" : "Relief élevé → plutôt aux sensations");
  if (w.type === "ef" || w.type === "sl") why.push("Boucle stable → effort maîtrisé");
  if (w.type === "cotes" || w.type === "trail") why.push("Relief présent → cohérent avec la séance");

  if (tD) why.push(`D+ ~${dplus} m (cible ${tD} m)`);

  return {
    score,
    why: why.slice(0, 6),
    meta: {
      targetKm: tKm,
      targetMin: tMin,
      targetDplus: tD ?? null,
      kmErr: round2(kmErr),
      minErr: Math.round(minErr),
      dErr: Math.round(dErr),
      usedPace: pace,
    },
  };
}

/* --------------------------------- API ----------------------------------- */

export function generateRoutesForWorkout(input: GeneratorInput): ScoredRoute[] {
  const start = input?.start;
  const workout = input?.workout;

  if (!start || !Number.isFinite(start.lat) || !Number.isFinite(start.lng)) return [];
  if (!workout || typeof workout.workoutKey !== "string") return [];
  if (workout.type === "rest") return [];

  const pace = defaultPaceMinPerKm(workout.type);

  // objectif principal (km) : si non fourni -> fallback selon type
  const targetKm =
    targetKmFromWorkout(workout, pace) ??
    (workout.type === "sl" ? 12 : workout.type === "trail" ? 10 : workout.type === "cotes" ? 8 : workout.type === "seuil" ? 7 : 6);

  const createdAt = nowMs();

  // 3 profils de route — toutes "autour" de targetKm, avec léger offset
  const variants: Array<{
    name: string;
    mode: "simple" | "balanced" | "workout";
    kmFactor: number; // 0.92 / 1.00 / 1.06 etc.
  }> = [
    { name: "Boucle simple", mode: "simple", kmFactor: 0.92 },
    { name: "Boucle équilibrée", mode: "balanced", kmFactor: 1.0 },
    { name: "Boucle adaptée séance", mode: "workout", kmFactor: 1.06 },
  ];

  const routes: ScoredRoute[] = variants.map((v, idx) => {
    const tKm = clamp(targetKm * v.kmFactor, 1.5, 60);

    // on cherche un scale qui colle à la distance cible
    const scale = findScaleForTargetKm({ start, targetKm: tKm, mode: v.mode });

    // build points + mesure réelle
    const pts = makeLoop(start, scale, v.mode);
    const km = distanceKm(pts);

    // durée estimée
    const estMin = Math.max(10, Math.round(km * pace));

    // D+ mock dépendant km/scale
    const dplus = estimateDplus(workout, km, scale);

    const scored = scoreRoute({ km, estMin, dplus, w: workout, pace });

    return {
      id: makeId(workout.workoutKey, createdAt, idx),
      name: v.name,
      sport: workout.type === "trail" ? "trail" : "run",
      points: pts,
      distanceKm: round2(km),
      elevationGainM: dplus,
      estimatedTimeMin: estMin,
      tags: tagsFor(workout.type),
      createdBy: "ai",
      createdAt,
      workoutKey: workout.workoutKey,

      score: scored.score,
      why: scored.why,
      meta: {
        ...scored.meta,
        usedScale: round2(scale),
      },
    };
  });

  routes.sort((a, b) => b.score - a.score);

  return routes;
}
