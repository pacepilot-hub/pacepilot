// storage/types.ts

/**
 * Types UI (stable / sérialisables) — Beta-ready (multi-sport)
 * - Primitives + enums + tuples
 * - Readonly par défaut (anti-mutation accidentelle)
 * - Type guards + normalizers (compat legacy)
 */

/* --------------------------------- enums --------------------------------- */

/**
 * ✅ Multi-sport (selon ton speech)
 * - course à pied, trail, vélo route, VTT, randonnée, natation
 * - + renfo / marche (déjà présents)
 *
 * ⚠️ Breaking change potentielle:
 * - si tu avais "Vélo" avant, on garde un normalizer compat (voir normalizeSportType)
 */
export const SPORT_TYPES = [
  "Course",
  "Trail",
  "Vélo route",
  "VTT",
  "Randonnée",
  "Natation",
  "Renfo",
  "Marche",
] as const;

export type SportType = (typeof SPORT_TYPES)[number];

export const WEATHER_ICONS = ["sunny", "partly", "rain", "cloud", "storm"] as const;
export type WeatherIcon = (typeof WEATHER_ICONS)[number];

export const INTENSITY_UI = ["easy", "steady", "threshold", "interval", "race"] as const;
export type IntensityUI = (typeof INTENSITY_UI)[number];

/* --------------------------------- route --------------------------------- */

/**
 * RoutePoint
 * - Tuple [lat, lon]
 * - lat: -90..90, lon: -180..180
 */
export type RoutePoint = readonly [number, number];

export type ActivityRouteUI = Readonly<{
  points: ReadonlyArray<RoutePoint>;
}>;

/* -------------------------------- weather -------------------------------- */

export type ActivityWeatherUI = Readonly<{
  temp?: number; // °C
  icon?: WeatherIcon;
  wind?: string; // ex "12 km/h"
}>;

/* -------------------------------- activity -------------------------------- */

/**
 * ActivityUI est volontairement générique (tous sports).
 * Les métriques peuvent varier selon sport:
 * - Course/Trail: paceSecPerKm, elevation, etc (à venir)
 * - Vélo: speed, D+ (à venir)
 * - Natation: distance, temps, allure/100m (à venir)
 *
 * Pour la bêta: on garde un set minimal + extensible.
 */
export type ActivityUI = Readonly<{
  id: string;

  sport: SportType;
  title: string;

  /** Affichage (ex: "Lun 22 jan") */
  dateLabel: string;

  /** Affichage (optionnel) */
  location?: string;

  /** Base métrique */
  distanceKm?: number;

  /** Base charge */
  durationSec?: number;

  /** Optionnel (plutôt course) */
  paceSecPerKm?: number;

  calories?: number;

  /** Charge perçue (optionnel) */
  rpe?: number; // 1..10

  intensity?: IntensityUI;

  weather?: ActivityWeatherUI;
  route?: ActivityRouteUI;
}>;

/* --------------------------------- weekly -------------------------------- */

export const DOW_LABELS = ["L", "M", "Me", "J", "V", "S", "D"] as const;
export type DOWLabel = (typeof DOW_LABELS)[number];

export type WeekDayUI = Readonly<{
  dow: DOWLabel;
  temp?: number;
  icon: WeatherIcon;
}>;

export type WeeklyGoalUI = Readonly<{
  label: string;
  value: string;
}>;

export type WeeklyPlanUI = Readonly<{
  weekLabel: string;
  goals: ReadonlyArray<WeeklyGoalUI>;
  days: ReadonlyArray<WeekDayUI>;
  todayIndex: number; // 0..6
}>;

/* ------------------------------- type guards ------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isSportType(v: unknown): v is SportType {
  return typeof v === "string" && (SPORT_TYPES as readonly string[]).includes(v);
}

export function isWeatherIcon(v: unknown): v is WeatherIcon {
  return typeof v === "string" && (WEATHER_ICONS as readonly string[]).includes(v);
}

export function isIntensityUI(v: unknown): v is IntensityUI {
  return typeof v === "string" && (INTENSITY_UI as readonly string[]).includes(v);
}

export function isDOWLabel(v: unknown): v is DOWLabel {
  return typeof v === "string" && (DOW_LABELS as readonly string[]).includes(v);
}

export function isRoutePoint(v: unknown): v is RoutePoint {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    Number.isFinite(v[0]) &&
    typeof v[1] === "number" &&
    Number.isFinite(v[1])
  );
}

export function isActivityUI(v: unknown): v is ActivityUI {
  if (!isRecord(v)) return false;

  if (typeof v.id !== "string" || !v.id.trim()) return false;
  if (!isSportType(v.sport)) return false;
  if (typeof v.title !== "string" || !v.title.trim()) return false;
  if (typeof v.dateLabel !== "string" || !v.dateLabel.trim()) return false;

  if (v.distanceKm != null && (typeof v.distanceKm !== "number" || !Number.isFinite(v.distanceKm) || v.distanceKm < 0))
    return false;

  if (
    v.durationSec != null &&
    (typeof v.durationSec !== "number" || !Number.isFinite(v.durationSec) || v.durationSec < 0)
  )
    return false;

  if (
    v.paceSecPerKm != null &&
    (typeof v.paceSecPerKm !== "number" || !Number.isFinite(v.paceSecPerKm) || v.paceSecPerKm <= 0)
  )
    return false;

  if (v.rpe != null && (typeof v.rpe !== "number" || !Number.isFinite(v.rpe) || v.rpe < 1 || v.rpe > 10))
    return false;

  if (v.intensity != null && !isIntensityUI(v.intensity)) return false;

  if (v.weather != null) {
    if (!isRecord(v.weather)) return false;
    if (v.weather.icon != null && !isWeatherIcon(v.weather.icon)) return false;
    if (v.weather.temp != null && (typeof v.weather.temp !== "number" || !Number.isFinite(v.weather.temp))) return false;
    if (v.weather.wind != null && typeof v.weather.wind !== "string") return false;
  }

  if (v.route != null) {
    if (!isRecord(v.route)) return false;
    const pts = (v.route as any).points;
    if (!Array.isArray(pts) || pts.length < 2) return false;
    if (!pts.every(isRoutePoint)) return false;
  }

  return true;
}

/* ------------------------------ normalizers ------------------------------- */

/**
 * Compat legacy:
 * - "Vélo" (ancien) => "Vélo route"
 * - "Course" / "Trail" etc: passthrough
 * - libellés proches => meilleure tolérance
 */
export function normalizeSportType(input: unknown, fallback: SportType = "Course"): SportType {
  const s = typeof input === "string" ? input.trim() : "";
  if (!s) return fallback;

  // exact
  if (isSportType(s)) return s;

  const low = s.toLowerCase();

  // legacy / alias
  if (low === "vélo" || low === "velo" || low.includes("bike")) return "Vélo route";
  if (low.includes("vtt") || low.includes("mtb")) return "VTT";
  if (low.includes("trail")) return "Trail";
  if (low.includes("rando") || low.includes("hike") || low.includes("randonnée")) return "Randonnée";
  if (low.includes("swim") || low.includes("natation") || low.includes("piscine")) return "Natation";
  if (low.includes("walk") || low.includes("marche")) return "Marche";
  if (low.includes("renfo") || low.includes("strength") || low.includes("muscu")) return "Renfo";
  if (low.includes("course") || low.includes("run")) return "Course";

  return fallback;
}

/* ------------------------------ tiny helpers ------------------------------ */

/** 0..6 -> DOWLabel (fallback "L") */
export function dowLabelFromIndex(i: number): DOWLabel {
  if (!Number.isFinite(i)) return "L";
  const idx = Math.max(0, Math.min(6, Math.round(i)));
  return DOW_LABELS[idx] ?? "L";
}
