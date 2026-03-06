// coaching/derivedState.ts
import type { Activity } from "@/storage/activities";
import { summarizeRange, isoDaysAgo, estimateMinutesFromActivity } from "@/coaching/mappers";
import { parseISODateLocal, weekStartFromISO, todayISO as todayISOFromDates } from "@/coaching/dates";

export type FatigueLevel = "low" | "medium" | "high";
export type Confidence = "low" | "medium" | "high";

export type DerivedState = {
  fatigueLevel: FatigueLevel;
  fatigueScore: number; // 0..100
  toleranceScore: number; // 0..100
  adherenceScore: number; // 0..100
  confidence: Confidence;

  // infos utiles pour explication IA / UI
  last7DaysLoad: number;
  last21DaysLoad: number;
  last7DaysMinutes: number;
  last21DaysMinutes: number;
  last7DaysElevation: number;
};

/* -------------------------------- utils --------------------------------- */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** ISO "YYYY-MM-DD" strict (garde-fou minimal) */
function safeISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  // garde-fou supplémentaire: parse local, si NaN => invalide
  const dt = parseISODateLocal(s);
  if (!dt || Number.isNaN(dt.getTime())) return null;

  return s;
}

/** Récupère l’ISO d’une activité, tolérant (selon ton storage) */
function getActivityISO(a: Activity): string | null {
  const any: any = a as any;

  // champ canonique
  const d1 = safeISO(any?.date);
  if (d1) return d1;

  // fallback started_at datetime -> YYYY-MM-DD
  if (typeof any?.started_at === "string" && any.started_at.length >= 10) {
    const d2 = safeISO(String(any.started_at).slice(0, 10));
    if (d2) return d2;
  }

  return null;
}

/** windowDays=7 => [J-6 .. J] inclusif */
function rangeISOInclusive(windowDays: number, nowISO?: string): { from: string; to: string } {
  // Important: isoDaysAgo() vient de ton mapper, donc “source unique” côté app.
  // Si nowISO fourni, on calcule le delta via parseISODateLocal (sans UTC traps).
  if (nowISO && safeISO(nowISO)) {
    const to = nowISO;
    const d = parseISODateLocal(nowISO);
    d.setDate(d.getDate() - Math.max(0, windowDays - 1));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const from = `${y}-${m}-${day}`;
    return { from, to };
  }

  const to = isoDaysAgo(0);
  const from = isoDaysAgo(Math.max(0, windowDays - 1));
  return { from, to };
}

/** Filtre activités dans [from..to] (inclusif) avec garde-fous */
function filterRange(list: Activity[], from: string, to: string): Activity[] {
  return (list ?? []).filter((a) => {
    const iso = getActivityISO(a);
    return !!iso && iso >= from && iso <= to;
  });
}

/* ------------------------------ confidence ------------------------------- */

function computeConfidence(all: Activity[], nowISO?: string): Confidence {
  // Qualité des données sur 21 jours
  const { from, to } = rangeISOInclusive(21, nowISO);
  const recent = filterRange(all, from, to);

  // sceptique: trop peu d’activités => low direct
  if (recent.length < 3) return "low";

  const withRpe =
    recent.filter((a: any) => isFiniteNumber(a?.rpe)).length / recent.length;

  const withDurOrDist =
    recent.filter((a: any) => {
      const hasDur = isFiniteNumber(a?.durationMin);
      const hasDist = isFiniteNumber(a?.distanceKm);
      return hasDur || hasDist;
    }).length / recent.length;

  // si minutes estimables très faibles, on ne peut pas être "high"
  const mins = recent
    .map((a) => estimateMinutesFromActivity(a))
    .map((m) => (isFiniteNumber(m) ? Math.max(0, m) : 0));

  const totalMin = mins.reduce((acc, v) => acc + v, 0);
  const hasUsableVolume = totalMin >= 60; // < 1h sur 21j => données trop faibles

  // score pondéré (volume fiable > rpe)
  const score = 0.7 * withDurOrDist + 0.3 * withRpe;

  if (score >= 0.82 && recent.length >= 6 && hasUsableVolume) return "high";
  if (score >= 0.52) return "medium";
  return "low";
}

/* ------------------------------ fatigue ---------------------------------- */

function computeFatigue(last7Load: number, last21Load: number): { level: FatigueLevel; score: number } {
  const l7 = Math.max(0, isFiniteNumber(last7Load) ? last7Load : 0);
  const l21 = Math.max(0, isFiniteNumber(last21Load) ? last21Load : 0);

  // base “typique” = 21j / 3. Si 21j=0 => base minimale pour éviter /0
  const base = l21 > 0 ? l21 / 3 : 1;

  const ratio = l7 / base; // ~1 = normal

  // score doux 0..100 (ratio 0.7 => 0 ; ratio 1.8 => ~100)
  const score = clamp(Math.round((ratio - 0.7) * 90), 0, 100);

  if (ratio >= 1.35) return { level: "high", score };
  if (ratio >= 1.08) return { level: "medium", score };
  return { level: "low", score };
}

/* ------------------------------ adherence -------------------------------- */

function computeAdherenceScore(all: Activity[], nowISO?: string): number {
  // 28 jours: semaines actives + densité d'activité
  const { from, to } = rangeISOInclusive(28, nowISO);
  const recent = filterRange(all, from, to);
  if (recent.length === 0) return 0;

  // semaines actives = bucket par lundi ISO
  const weekStarts = new Set<string>();
  for (const a of recent) {
    const iso = getActivityISO(a);
    if (!iso) continue;
    weekStarts.add(weekStartFromISO(iso));
  }

  const weeksActive = clamp(weekStarts.size, 0, 4);

  // densité : 12 activités/28j = excellent
  const density = clamp(recent.length / 12, 0, 1);

  // pondération : semaines 80%, densité 20%
  return clamp(Math.round((weeksActive / 4) * 80 + density * 20), 0, 100);
}

/* ------------------------------ tolerance -------------------------------- */

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function computeToleranceScore(all: Activity[], nowISO?: string): number {
  // 28 jours: minutes hebdo + stabilité (pics)
  const { from, to } = rangeISOInclusive(28, nowISO);
  const recent = filterRange(all, from, to);
  if (recent.length === 0) return 0;

  const mins = recent
    .map((a) => estimateMinutesFromActivity(a))
    .map((m) => (isFiniteNumber(m) ? Math.max(0, m) : 0))
    .filter((m) => m > 0);

  if (mins.length === 0) return 0;

  const totalMin = mins.reduce((acc, v) => acc + v, 0);
  const avgWeeklyMin = totalMin / 4;

  // score minutes : 240 min/sem ~ 70 pts
  const minScore = clamp(Math.round((avgWeeklyMin / 240) * 70), 0, 70);

  // stabilité:
  // - on utilise la médiane de séance comme repère
  // - spike si une séance dépasse 60% du volume hebdo moyen (plus protecteur)
  const med = median(mins);
  const spikeByWeekly = avgWeeklyMin > 0 && mins.some((m) => m > avgWeeklyMin * 0.6);

  // un autre signal: séance ultra longue vs médiane
  const spikeByMedian = med > 0 && mins.some((m) => m > med * 2.8);

  const hasSpike = spikeByWeekly || spikeByMedian;

  // bonus stabilité (plus strict = plus protecteur)
  const stabilityScore = hasSpike ? 14 : 30;

  return clamp(minScore + stabilityScore, 0, 100);
}

/* ---------------------------------- API ---------------------------------- */

/**
 * API principale
 * `nowISO` optionnel pour rendre le calcul déterministe (tests/replays).
 * Si non fourni, on suit le temps réel (via isoDaysAgo()).
 */
export function computeDerivedState(allActivities: Activity[], nowISO?: string): DerivedState {
  // window defs
  const r7 = rangeISOInclusive(7, nowISO);
  const r21 = rangeISOInclusive(21, nowISO);

  // ✅ charge/minutes/elevation viennent du mapper (source unique)
  const s7 = summarizeRange(allActivities, r7.from, r7.to);
  const s21 = summarizeRange(allActivities, r21.from, r21.to);

  const fat = computeFatigue(s7.load, s21.load);
  const confidence = computeConfidence(allActivities, nowISO);

  return {
    fatigueLevel: fat.level,
    fatigueScore: fat.score,
    toleranceScore: computeToleranceScore(allActivities, nowISO),
    adherenceScore: computeAdherenceScore(allActivities, nowISO),
    confidence,

    last7DaysLoad: s7.load,
    last21DaysLoad: s21.load,
    last7DaysMinutes: s7.minutes,
    last21DaysMinutes: s21.minutes,
    last7DaysElevation: s7.elevation,
  };
}

/**
 * Petit helper pratique: état dérivé “maintenant” en ISO local
 * (optionnel, mais utile si tu veux brancher partout la même date)
 */
export function computeDerivedStateNow(allActivities: Activity[]): DerivedState {
  const nowISO = todayISOFromDates();
  return computeDerivedState(allActivities, nowISO);
}
