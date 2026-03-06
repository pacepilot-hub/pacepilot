// coaching/decisionEngine.ts
import type { Session, Intensity } from "@/storage/trainingPlan";
import type { Activity, ActivityContext } from "@/storage/activities";
import type { DerivedState, Confidence } from "@/coaching/derivedState";
import { toISODateLocal } from "@/coaching/dates";
import type { PacePilotScoreInput } from "@/coaching/physioScoring";
import { computePacePilotScore } from "@/coaching/physioScoring";

/**
 * Decision Engine V1.2
 * Principes:
 * 1) Sécurité > ressenti > continuité > données > objectif > plan
 * 2) Pas de punition / pas de dette
 * 3) Minimum efficace toujours présent
 * 4) Explicable + humble (confidence)
 */

/* --------------------------------- types --------------------------------- */

export type DecisionMode = "observation" | "progression" | "maintenance" | "recovery" | "safety";

export type DecisionReasonCode =
  | "PAIN_REPORTED"
  | "FATIGUE_HIGH"
  | "FATIGUE_MEDIUM"
  | "CONFIDENCE_LOW"
  | "WEATHER_HOT"
  | "WEATHER_WIND"
  | "WEATHER_RAIN"
  | "SLEEP_BAD"
  | "STRESS_HIGH"
  | "MISSED_SESSIONS"
  | "OVERLOAD"
  | "PLANNED_SESSION_OK"
  | "SIMPLIFY_FOR_CONTINUITY"
  | "AUTONOMIC_LOCK"
  | "FATIGUE_SLEEP_LOCK"
  | "MEDICAL_STOP";

export type DecisionReason = {
  code: DecisionReasonCode;
  text: string;
  weight: 1 | 2 | 3;
};

export type Decision = {
  mode: DecisionMode;
  confidence: Confidence;
  session: Session;
  fallback?: Session;
  reasons: DecisionReason[];
};

/**
 * Contraintes météo dérivées (optionnelles)
 * - si absent => comportement identique (ou proche)
 */
export type WeatherConstraints = {
  softenIntensity?: boolean;
  avoidPaceTargets?: boolean;
  shortenFactor?: number; // ex 0.92 => -8%
  reasonsText?: string[]; // UI-safe
};

export type TodayContext = ActivityContext & {
  pain?: { zone: string; level: 1 | 2 | 3 } | null;
  rpeFeeling?: number; // 0..10 (optionnel)
  weatherConstraints?: WeatherConstraints;
  physioScoreInput?: PacePilotScoreInput | null;
};

type Options = {
  minEffectiveMinutes?: number; // default 20
  softenIntensity?: boolean; // default true
  todayISO?: string; // "YYYY-MM-DD" (si tu veux maîtriser le jour du calcul)
};

const DEFAULT_MIN_EFF = 20;
const DEFAULT_DOW: number = 1; // Mar (fallback)
const MS_DAY = 86400000;

/* -------------------------------- helpers -------------------------------- */

export function reasonsToText(reasons: DecisionReason[] | undefined | null): string[] {
  if (!Array.isArray(reasons)) return [];
  return reasons
    .map((r) => (typeof r?.text === "string" ? r.text.trim() : ""))
    .filter(Boolean)
    .slice(0, 8);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function round5(n: number) {
  return Math.round(n / 5) * 5;
}

function jsDowToMon0(jsDow: number): number {
  // JS getDay(): Dim=0..Sam=6  => Lun=0..Dim=6
  return jsDow === 0 ? 6 : jsDow - 1;
}

function isoDaysAgo(n: number, now: Date = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  d.setTime(d.getTime() - Math.trunc(n) * MS_DAY);
  return toISODateLocal(d);
}

function firstNonEmpty(arr?: string[] | null): string | null {
  if (!Array.isArray(arr)) return null;
  for (const x of arr) {
    if (typeof x === "string" && x.trim()) return x.trim();
  }
  return null;
}

function minutesOfSession(s: Session): number {
  if (typeof (s as any)?.durationMin === "number" && Number.isFinite((s as any).durationMin)) {
    return Math.max(0, Math.round((s as any).durationMin));
  }

  // fallback distance → minutes (heuristique)
  if (typeof (s as any)?.distanceKm === "number" && Number.isFinite((s as any).distanceKm)) {
    return Math.max(10, Math.round((s as any).distanceKm * 6)); // 6’/km grossier
  }

  return 0;
}

function withDuration(s: Session, durationMin: number): Session {
  const d = Math.max(0, Math.round(durationMin));
  return { ...s, durationMin: d };
}

function mkSession(params: {
  dayOfWeek: number;
  label: string;
  intensity: Intensity;
  durationMin: number;
  notes?: string;
}): Session {
  return {
    dayOfWeek: clamp(params.dayOfWeek, 0, 6),
    label: params.label,
    intensity: params.intensity,
    durationMin: Math.max(0, Math.round(params.durationMin)),
    notes: params.notes,
  };
}

function joinNotes(a?: string, b?: string): string | undefined {
  const A = typeof a === "string" ? a.trim() : "";
  const B = typeof b === "string" ? b.trim() : "";
  if (!A && !B) return undefined;
  if (A && !B) return A;
  if (!A && B) return B;
  // éviter “phrase collée”
  return `${A}\n${B}`;
}

/* ----------------------- sessions primitives (library) -------------------- */

function minimalEffective(dayOfWeek: number, minEff: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Sortie facile (min)",
    intensity: "EASY",
    durationMin: Math.max(12, round5(minEff)),
    notes: "Version minimale efficace. Très souple, respiration facile.",
  });
}

function recoverySession(dayOfWeek: number, minEff: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Récupération",
    intensity: "RECOVERY",
    durationMin: Math.max(10, round5(Math.min(minEff, 25))),
    notes: "Marche active ou footing très léger. Objectif : récupérer.",
  });
}

function mobilitySession(dayOfWeek: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Mobilité / étirements",
    intensity: "RECOVERY",
    durationMin: 15,
    notes: "Mobilité douce + étirements légers. Zéro douleur.",
  });
}

function easySession(dayOfWeek: number, minutes: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Footing",
    intensity: "EASY",
    durationMin: round5(minutes),
    notes: "Allure confortable, tu peux parler en phrases complètes.",
  });
}

function longSession(dayOfWeek: number, minutes: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Sortie longue",
    intensity: "LONG",
    durationMin: round5(minutes),
    notes: "Très facile. Objectif : endurance + régularité.",
  });
}

function thresholdSession(dayOfWeek: number, minutes: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Tempo / seuil",
    intensity: "THRESHOLD",
    durationMin: round5(minutes),
    notes: "Effort soutenu contrôlé. Si dérive : ralentis ou passe en footing.",
  });
}

function intervalSession(dayOfWeek: number, minutes: number): Session {
  return mkSession({
    dayOfWeek,
    label: "Intervalles",
    intensity: "INTERVAL",
    durationMin: round5(minutes),
    notes: "Qualité. Échauffement + blocs + retour au calme. Reste propre.",
  });
}

/* -------------------------- heuristics / detection ------------------------ */

function isKeyIntensity(i: Intensity) {
  // IMPORTANT: n’inclure ici que des valeurs réellement dans ton union Intensity
  return i === "INTERVAL" || i === "THRESHOLD";
}

function getActivityISO(a: Activity): string | null {
  // On essaye plusieurs champs possibles (selon ton storage)
  const any: any = a as any;
  if (typeof any?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(any.date)) return any.date;
  if (typeof any?.started_at === "string") {
    // started_at ISO datetime -> prendre la date
    const d = String(any.started_at).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  }
  return null;
}

function detectPainSignal(today?: TodayContext, recent?: Activity[]): { risky: boolean; mild: boolean } {
  const tPain = today?.pain;

  // douleur du jour
  if (tPain?.level && tPain.level >= 2) return { risky: true, mild: true };
  if (tPain?.level === 1) return { risky: false, mild: true };

  // douleur récente (si tu la stockes sur l’activité)
  const now = new Date();
  const fromISO = isoDaysAgo(7, now);

  const last7 = (recent ?? []).filter((a) => {
    const iso = getActivityISO(a);
    return iso ? iso >= fromISO : false;
  });

  const painReports = last7.filter((a) => {
    const any: any = a as any;
    const p = any?.pain;
    return p && typeof p?.level === "number" && p.level >= 2;
  }).length;

  if (painReports >= 2) return { risky: true, mild: true };
  if (painReports === 1) return { risky: false, mild: true };
  return { risky: false, mild: false };
}

/* ------------------------------ context reasons --------------------------- */

function buildContextReasons(state: DerivedState, today?: TodayContext): DecisionReason[] {
  const reasons: DecisionReason[] = [];

  if (state.fatigueLevel === "high") {
    reasons.push({ code: "FATIGUE_HIGH", weight: 3, text: "Fatigue élevée détectée sur les derniers jours." });
  } else if (state.fatigueLevel === "medium") {
    reasons.push({ code: "FATIGUE_MEDIUM", weight: 2, text: "Fatigue modérée : on reste prudent." });
  }

  if (state.confidence === "low") {
    reasons.push({ code: "CONFIDENCE_LOW", weight: 2, text: "Peu de données récentes : prudence par défaut." });
  }

  if (today?.sleep === "bad") reasons.push({ code: "SLEEP_BAD", weight: 2, text: "Sommeil mauvais : on allège." });
  if (today?.stress === "high") reasons.push({ code: "STRESS_HIGH", weight: 2, text: "Stress élevé : on protège la récup." });

  // météo v0 (tags simples)
  if (today?.weather === "hot") reasons.push({ code: "WEATHER_HOT", weight: 2, text: "Chaleur : on baisse l'intensité." });
  if (today?.weather === "rain") reasons.push({ code: "WEATHER_RAIN", weight: 1, text: "Pluie : prudence sur la charge." });
  if (today?.weather === "wind") reasons.push({ code: "WEATHER_WIND", weight: 1, text: "Vent : sensations > allure." });

  // météo v1 (contraintes riches)
  const wc = today?.weatherConstraints;
  if (wc) {
    const t = firstNonEmpty(wc.reasonsText);
    if (t) {
      if (wc.softenIntensity) reasons.push({ code: "WEATHER_HOT", weight: 2, text: t });
      else if (wc.avoidPaceTargets) reasons.push({ code: "WEATHER_WIND", weight: 1, text: t });
      else reasons.push({ code: "WEATHER_RAIN", weight: 1, text: t });
    }
  }

  return reasons;
}

function chooseMode(state: DerivedState, pain: { risky: boolean; mild: boolean }, reasons: DecisionReason[]): DecisionMode {
  if (pain.risky) return "safety";

  const badSleepOrStress = reasons.some((r) => r.code === "SLEEP_BAD" || r.code === "STRESS_HIGH");
  if (state.fatigueLevel === "high" || badSleepOrStress) return "recovery";

  if (state.fatigueLevel === "medium" || state.confidence === "low" || pain.mild) return "maintenance";

  if (state.fatigueLevel === "low" && (state.confidence === "high" || state.confidence === "medium")) return "progression";

  return "observation";
}

function applyScoreLocks(mode: DecisionMode, today?: TodayContext): {
  mode: DecisionMode;
  lockReasons: DecisionReason[];
} {
  const scoreInput = today?.physioScoreInput;
  if (!scoreInput) return { mode, lockReasons: [] };

  const score = computePacePilotScore(scoreInput);
  const locks = score.locks;
  const lockReasons: DecisionReason[] = [];

  if (locks.medicalStop) {
    lockReasons.push({ code: "MEDICAL_STOP", weight: 3, text: "Alerte santé: arrêt immédiat et avis médical recommandé." });
    return { mode: "safety", lockReasons };
  }

  if (locks.lockPain) {
    lockReasons.push({ code: "PAIN_REPORTED", weight: 3, text: "Verrou sécurité: douleur > 5/10." });
    return { mode: "safety", lockReasons };
  }

  if (locks.lockAutonomic) {
    lockReasons.push({ code: "AUTONOMIC_LOCK", weight: 3, text: "Verrou sécurité: HRV/FC repos défavorable, Z1 max ou repos." });
    return { mode: "recovery", lockReasons };
  }

  if (locks.lockFatigueSleep) {
    lockReasons.push({ code: "FATIGUE_SLEEP_LOCK", weight: 3, text: "Verrou sécurité: fatigue élevée + sommeil insuffisant." });
    return { mode: "recovery", lockReasons };
  }

  return { mode, lockReasons };
}

/* ------------------------------ weather effects --------------------------- */

function applyWeatherOnMinutes(baseMin: number, today?: TodayContext): number {
  const sfRaw = today?.weatherConstraints?.shortenFactor;
  const sf = typeof sfRaw === "number" && Number.isFinite(sfRaw) ? clamp(sfRaw, 0.7, 1.0) : 1.0;
  return Math.round(baseMin * sf);
}

function weatherNote(today?: TodayContext): string | undefined {
  const wc = today?.weatherConstraints;
  if (wc?.avoidPaceTargets) return "Météo : privilégie les sensations plutôt que l’allure.";
  if (today?.weather === "hot") return "Chaleur : baisse l'intensité, hydrate-toi.";
  if (today?.weather === "rain") return "Pluie : prudence sur l'adhérence.";
  if (today?.weather === "wind") return "Vent : cours aux sensations.";
  return undefined;
}

function softenIntensityValue(intensity: Intensity): Intensity {
  if (intensity === "INTERVAL" || intensity === "THRESHOLD") return "EASY";
  if (intensity === "LONG") return "EASY";
  return intensity;
}

/* ---------------------------- plan adaptations ---------------------------- */

function buildByIntensity(dow: number, intensity: Intensity, minutes: number): Session {
  switch (intensity) {
    case "LONG":
      return longSession(dow, minutes);
    case "THRESHOLD":
      return thresholdSession(dow, minutes);
    case "INTERVAL":
      return intervalSession(dow, minutes);
    case "RECOVERY":
      return recoverySession(dow, minutes);
    default:
      return easySession(dow, minutes);
  }
}

function adaptPlannedSession(params: {
  planned: Session;
  mode: DecisionMode;
  today?: TodayContext;
  minEff: number;
  options?: Options;
}): { session: Session; fallback?: Session; extraReasons?: DecisionReason[] } {
  const { planned, mode, today, minEff } = params;
  const soften = params.options?.softenIntensity ?? true;

  const dow = clamp(planned.dayOfWeek, 0, 6);

  const plannedMin = minutesOfSession(planned);
  const baseMinRaw = plannedMin > 0 ? plannedMin : planned.intensity === "LONG" ? 75 : 40;
  const baseMin = applyWeatherOnMinutes(baseMinRaw, today);

  const fallback = minimalEffective(dow, minEff);
  const wxNote = weatherNote(today);

  if (mode === "safety") {
    return {
      session: mobilitySession(dow),
      fallback: recoverySession(dow, minEff),
      extraReasons: [{ code: "PAIN_REPORTED", weight: 3, text: "Douleur signalée : priorité sécurité." }],
    };
  }

  if (mode === "recovery") {
    const m = clamp(baseMin * 0.6, 15, 45);
    const s = easySession(dow, m);
    return {
      session: { ...s, notes: joinNotes(s.notes, wxNote) },
      fallback,
      extraReasons: [{ code: "SIMPLIFY_FOR_CONTINUITY", weight: 2, text: "On allège pour protéger la récupération." }],
    };
  }

  if (mode === "maintenance") {
    // séance clé => simplification + possible “soften”
    if (isKeyIntensity(planned.intensity)) {
      const m = clamp(baseMin * 0.8, 20, 55);
      const s = soften ? thresholdSession(dow, m) : buildByIntensity(dow, planned.intensity, m);
      return {
        session: { ...s, notes: joinNotes(s.notes, wxNote) },
        fallback,
        extraReasons: [{ code: "SIMPLIFY_FOR_CONTINUITY", weight: 2, text: "Séance clé adoucie (maintenance)." }],
      };
    }

    // SL => raccourcie
    if (planned.intensity === "LONG") {
      const m = clamp(baseMin * 0.85, 30, 110);
      const s = longSession(dow, m);
      return { session: { ...s, notes: joinNotes(s.notes, wxNote) }, fallback };
    }

    // easy / recovery
    const m = clamp(baseMin * 0.9, 20, 60);
    const s = easySession(dow, m);
    return { session: { ...s, notes: joinNotes(s.notes, wxNote) }, fallback };
  }

  // progression / observation: proche du plan, météo + soften si demandé
  {
    const m = applyWeatherOnMinutes(baseMinRaw, today);

    const shouldSoften =
      soften && (today?.weatherConstraints?.softenIntensity === true || today?.weather === "hot");

    const intensity = shouldSoften ? softenIntensityValue(planned.intensity) : planned.intensity;

    const session: Session = {
      ...planned,
      intensity,
      durationMin: planned.durationMin ?? round5(m),
      notes: joinNotes(planned.notes, wxNote),
    };

    return { session, fallback };
  }
}

function proposeWithoutPlan(params: {
  dow: number;
  mode: DecisionMode;
  minEff: number;
  today?: TodayContext;
}): { session: Session; fallback?: Session; extraReasons?: DecisionReason[] } {
  const { dow, mode, minEff, today } = params;
  const fallback = minimalEffective(dow, minEff);
  const wxNote = weatherNote(today);

  if (mode === "safety") {
    return {
      session: mobilitySession(dow),
      fallback: recoverySession(dow, minEff),
      extraReasons: [{ code: "PAIN_REPORTED", weight: 3, text: "Douleur signalée : priorité sécurité." }],
    };
  }

  if (mode === "recovery") {
    const s = recoverySession(dow, minEff);
    return {
      session: { ...s, notes: joinNotes(s.notes, wxNote) },
      fallback,
      extraReasons: [{ code: "SIMPLIFY_FOR_CONTINUITY", weight: 2, text: "Récupération prioritaire aujourd'hui." }],
    };
  }

  if (mode === "maintenance" || mode === "observation") {
    const s = easySession(dow, 30);
    return { session: { ...s, notes: joinNotes(s.notes, wxNote) }, fallback };
  }

  const s = thresholdSession(dow, 40);
  return {
    session: { ...s, notes: joinNotes(s.notes, wxNote) },
    fallback,
    extraReasons: [{ code: "PLANNED_SESSION_OK", weight: 1, text: "Séance simple pour progresser en douceur." }],
  };
}

/* ------------------------------- confidence ------------------------------- */

function capConfidence(base: Confidence, cap: Confidence): Confidence {
  // ordre: low < medium < high
  const rank = (c: Confidence) => (c === "low" ? 0 : c === "medium" ? 1 : 2);
  return rank(base) > rank(cap) ? cap : base;
}

/* --------------------------------- API ----------------------------------- */

export function decideTodaySession(params: {
  planned?: Session | null;
  state: DerivedState;
  recentActivities?: Activity[];
  today?: TodayContext;
  options?: Options;
}): Decision {
  const minEff = params.options?.minEffectiveMinutes ?? DEFAULT_MIN_EFF;

  const reasons = buildContextReasons(params.state, params.today);
  const pain = detectPainSignal(params.today, params.recentActivities);

  if (pain.mild && !pain.risky) {
    reasons.push({ code: "PAIN_REPORTED", weight: 2, text: "Sensibilité/douleur légère : prudence." });
  }

  const baseMode = chooseMode(params.state, pain, reasons);
  const lockOutcome = applyScoreLocks(baseMode, params.today);
  const mode = lockOutcome.mode;
  if (lockOutcome.lockReasons.length) reasons.push(...lockOutcome.lockReasons);

  // Jour du calcul
  const todayISO = params.options?.todayISO;
  const jsDow = todayISO ? new Date(`${todayISO}T12:00:00`).getDay() : new Date().getDay(); // midi évite edge TZ
  const fallbackDow = jsDowToMon0(jsDow);

  const planned = params.planned ?? null;
  const dowRaw = planned?.dayOfWeek ?? fallbackDow;
  const dayOfWeek = Number.isFinite(dowRaw) ? clamp(dowRaw, 0, 6) : DEFAULT_DOW;

  const chosen = planned
    ? adaptPlannedSession({ planned, mode, today: params.today, minEff, options: params.options })
    : proposeWithoutPlan({ dow: dayOfWeek, mode, minEff, today: params.today });

  const finalReasons = [...(chosen.extraReasons ?? []), ...reasons]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);

  const session = minutesOfSession(chosen.session) > 0 ? chosen.session : withDuration(chosen.session, 35);

  const fallback =
    chosen.fallback && minutesOfSession(chosen.fallback) > 0
      ? chosen.fallback
      : minimalEffective(dayOfWeek, minEff);

  // Confidence: si safety/recovery → on plafonne (plus humble)
  let confidence: Confidence = params.state.confidence;
  if (mode === "safety") confidence = capConfidence(confidence, "medium");
  if (mode === "recovery" && confidence === "high") confidence = "medium";

  return {
    mode,
    confidence,
    session,
    fallback,
    reasons: finalReasons,
  };
}
