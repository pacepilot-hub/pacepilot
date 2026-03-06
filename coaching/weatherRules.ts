// coaching/weatherRules.ts
import type { DailyWeather } from "@/services/weather";
import type { WeatherTag } from "@/storage/activities";

/**
 * deriveWeatherConstraints(day)
 * - robuste aux champs manquants / formats variables
 * - tag unique (priorité: storm/rain > hot > wind > normal)
 * - riskScore = somme de contributions, clamp 0..100
 * - shortenFactor = MIN des facteurs (la contrainte la plus forte gagne)
 * - reasonsText: courtes, uniques, max 4
 * - flags actionnables: softenIntensity / avoidPaceTargets / hydrationHint / footingSurfaceHint
 */

export type WeatherConstraints = {
  tag: WeatherTag;
  riskScore: number; // 0..100

  softenIntensity: boolean;
  avoidPaceTargets: boolean; // courir aux sensations plutôt qu'à l'allure
  hydrationHint: boolean;
  footingSurfaceHint: boolean; // prudence adhérence

  shortenFactor: number; // 1.0 normal, 0.85 = -15%
  reasonsText: string[]; // UI-safe
};

/* ------------------------------- thresholds ------------------------------- */

const TH = {
  heatWarm: 26,
  heatHot: 30,

  windWindy: 28,
  windStrong: 45,

  // pluie: si mm absent, on prendra une valeur médiane
  rainMmMin: 2,
  rainMmHeavy: 8,

  // shorten floors
  shortenMin: 0.65,
} as const;

/* --------------------------------- helpers -------------------------------- */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function numOrNull(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function pushReason(arr: string[], s: string) {
  const t = String(s || "").trim();
  if (!t) return;
  if (arr.includes(t)) return;
  arr.push(t);
}

/** Normalise l'icon en tokens simples */
function normalizeIcon(iconRaw: unknown): "storm" | "rain" | "snow" | "wind" | "clear" | "cloud" | "unknown" {
  const i = str(iconRaw).toLowerCase();
  if (!i) return "unknown";

  // variantes possibles selon API
  if (i.includes("thunder") || i.includes("orage")) return "storm";
  if (i.includes("storm")) return "storm";

  if (i.includes("rain") || i.includes("shower") || i.includes("pluie")) return "rain";
  if (i.includes("snow") || i.includes("neige")) return "snow";
  if (i.includes("wind") || i.includes("vent")) return "wind";
  if (i.includes("sun") || i.includes("clear") || i.includes("soleil")) return "clear";
  if (i.includes("cloud") || i.includes("nuage")) return "cloud";

  return "unknown";
}

type Signals = {
  tMax: number | null;
  wind: number | null;
  precip: number | null;
  icon: ReturnType<typeof normalizeIcon>;

  isStorm: boolean;
  isRainy: boolean;
  isHot: boolean;
  isWindy: boolean;
  isSnowy: boolean;
};

function extractSignals(day: DailyWeather): Signals {
  // Tolérance: plusieurs conventions possibles selon ton service météo
  const tMax = numOrNull((day as any).tMax ?? (day as any).tempMax ?? (day as any).maxTempC ?? (day as any).tempC);
  const wind = numOrNull((day as any).windMaxKmh ?? (day as any).windKmh ?? (day as any).windMax ?? (day as any).wind);
  const precip = numOrNull((day as any).precipMm ?? (day as any).precip ?? (day as any).rainMm ?? (day as any).rain);

  const icon = normalizeIcon((day as any).icon ?? (day as any).weatherIcon ?? (day as any).code ?? (day as any).summary);

  const isStorm = icon === "storm";
  const isSnowy = icon === "snow";

  // Pluie : icon pluie OR orage OR mm >= threshold
  const isRainByIcon = icon === "rain";
  const isRainByMm = precip !== null && precip >= TH.rainMmMin;
  const isRainy = isStorm || isRainByIcon || isRainByMm;

  const isHot = tMax !== null && tMax >= TH.heatWarm;
  const isWindy = wind !== null && wind >= TH.windWindy;

  return { tMax, wind, precip, icon, isStorm, isRainy, isHot, isWindy, isSnowy };
}

/**
 * Politique de tag (priorité) :
 * 1) storm/rain (sécurité)
 * 2) hot
 * 3) wind
 * 4) normal
 *
 * Si ton WeatherTag ne contient pas "storm" ou "snow", on retombe sur "rain"/"normal".
 */
function chooseTag(s: Signals): WeatherTag {
  // @ts-expect-error: si "storm" n'existe pas dans WeatherTag, TS gueule -> remplace par "rain"
  const STORM_TAG: WeatherTag = "storm";

  // @ts-expect-error: si "snow" n'existe pas dans WeatherTag, TS gueule -> remplace par "rain" ou "normal"
  const SNOW_TAG: WeatherTag = "snow";

  if (s.isStorm) {
    // si tu n'as pas "storm" dans WeatherTag: remplace par "rain"
    return (STORM_TAG ?? ("rain" as WeatherTag)) as WeatherTag;
  }

  if (s.isSnowy) {
    // optionnel: neige => prudence adhérence, sinon traite comme pluie
    return (SNOW_TAG ?? ("rain" as WeatherTag)) as WeatherTag;
  }

  if (s.isRainy) return "rain" as WeatherTag;
  if (s.isHot) return "hot" as WeatherTag;
  if (s.isWindy) return "wind" as WeatherTag;
  return "normal" as WeatherTag;
}

/* ------------------------------ contribution rules ------------------------------ */

function applyHeat(base: WeatherConstraints, s: Signals): number {
  const tMax = s.tMax;
  if (tMax === null) return 0;

  let risk = 0;

  if (tMax >= TH.heatHot) {
    risk += 35;
    base.softenIntensity = true;
    base.hydrationHint = true;
    base.avoidPaceTargets = true;
    base.shortenFactor = Math.min(base.shortenFactor, 0.85);
    pushReason(base.reasonsText, "Chaleur : baisse l’intensité et bois régulièrement.");
  } else if (tMax >= TH.heatWarm) {
    risk += 18;
    base.hydrationHint = true;
    base.avoidPaceTargets = true;
    base.shortenFactor = Math.min(base.shortenFactor, 0.92);
    pushReason(base.reasonsText, "Assez chaud : cours aux sensations.");
  }

  return risk;
}

function applyRainSnowStorm(base: WeatherConstraints, s: Signals): number {
  let risk = 0;

  if (s.isStorm) {
    risk += 45;
    base.softenIntensity = true;
    base.avoidPaceTargets = true;
    base.footingSurfaceHint = true;
    base.shortenFactor = Math.min(base.shortenFactor, 0.80);
    pushReason(base.reasonsText, "Orage : privilégie la sécurité (zones abritées).");
    return risk;
  }

  if (s.isSnowy) {
    risk += 30;
    base.softenIntensity = true;
    base.avoidPaceTargets = true;
    base.footingSurfaceHint = true;
    base.shortenFactor = Math.min(base.shortenFactor, 0.85);
    pushReason(base.reasonsText, "Neige/verglas possible : privilégie une surface sûre.");
    return risk;
  }

  if (s.isRainy) {
    const mm = s.precip ?? 3; // valeur médiane si API ne donne rien
    const contrib = clamp(Math.round(mm * 4), 8, 30);
    risk += contrib;

    base.avoidPaceTargets = true;
    base.footingSurfaceHint = true;
    base.shortenFactor = Math.min(base.shortenFactor, 0.92);

    if (mm >= TH.rainMmHeavy) pushReason(base.reasonsText, "Pluie soutenue : prudence, visibilité et adhérence.");
    else pushReason(base.reasonsText, "Pluie : prudence sur l’adhérence, adapte l’allure.");
  }

  return risk;
}

function applyWind(base: WeatherConstraints, s: Signals): number {
  const wind = s.wind;
  if (wind === null) return 0;

  let risk = 0;

  if (wind >= TH.windStrong) {
    risk += 30;
    base.avoidPaceTargets = true;
    base.softenIntensity = true;
    base.shortenFactor = Math.min(base.shortenFactor, 0.90);
    pushReason(base.reasonsText, "Vent fort : oublie l’allure cible, gère à l’effort.");
  } else if (wind >= TH.windWindy) {
    risk += 15;
    base.avoidPaceTargets = true;
    pushReason(base.reasonsText, "Vent : l’effort compte plus que l’allure.");
  }

  return risk;
}

/* -------------------------------- main API ---------------------------------- */

export function deriveWeatherConstraints(day: DailyWeather | null | undefined): WeatherConstraints {
  const base: WeatherConstraints = {
    tag: "normal" as WeatherTag,
    riskScore: 0,

    softenIntensity: false,
    avoidPaceTargets: false,
    hydrationHint: false,
    footingSurfaceHint: false,

    shortenFactor: 1.0,
    reasonsText: [],
  };

  if (!day) return base;

  const s = extractSignals(day);

  // contributions (cumulées)
  let risk = 0;
  risk += applyHeat(base, s);
  risk += applyRainSnowStorm(base, s);
  risk += applyWind(base, s);

  // tag final (priorité)
  base.tag = chooseTag(s);

  // clamp final
  base.riskScore = clamp(Math.round(risk), 0, 100);

  // UI: max 4 raisons
  base.reasonsText = base.reasonsText.slice(0, 4);

  // sécurité : shortenFactor borné
  base.shortenFactor = clamp(base.shortenFactor, TH.shortenMin, 1.0);

  return base;
}
