// storage/stats.ts
import { listActivities, type Activity } from "@/storage/activities";

/**
 * Stats (V1) — PacePilot
 * Objectifs:
 * - fonctions pures + API simple
 * - robustesse (data incomplète => stats stables)
 * - utile pour Progress + Home + Coach
 *
 * Ce module ne fait PAS de promesses médicales.
 */

/* --------------------------------- types --------------------------------- */

export type RangeKey = "7d" | "28d" | "12w" | "all";

export type WeeklyPoint = {
  weekKey: string; // ISO week key ex: "2026-W05"
  startISO: string; // YYYY-MM-DD (lundi)
  endISO: string; // YYYY-MM-DD (dimanche)
  sessions: number;
  distanceKm: number;
  durationMin: number;
  elevationGainM: number;
  load: number; // charge simple (minutes * rpe * facteur sport)
};

export type Summary = {
  fromISO: string;
  toISO: string;
  days: number;

  sessions: number;
  distanceKm: number;
  durationMin: number;
  elevationGainM: number;

  avgPerWeek: {
    sessions: number;
    distanceKm: number;
    durationMin: number;
    elevationGainM: number;
    load: number;
  };

  load: {
    acute7d: number; // charge 7j
    chronic28d: number; // charge 28j
    chronicWeekly: number; // chronic28d/4
    ratio: number; // acute7d / chronicWeekly
  };
};

export type Gauge = {
  label: "Forme" | "Fatigue" | "Charge";
  value: number; // 0..100
  tone: "green" | "orange" | "red" | "slate";
  hint?: string;
};

export type ComputeResult = {
  range: RangeKey;
  fromISO: string;
  toISO: string;
  summary: Summary;
  gauges: Gauge[];
  weeks: WeeklyPoint[]; // trié chronologique asc (pratique pour graphe)
  activitiesInRange: Activity[];
};

/* -------------------------------- constants ------------------------------- */

const MS_DAY = 24 * 60 * 60 * 1000;

/* --------------------------------- helpers -------------------------------- */

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isoToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function toISO(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string, delta: number): string {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + delta);
  return toISO(dt);
}

function diffDaysInclusive(fromISO: string, toISO: string): number {
  const a = parseISO(fromISO).getTime();
  const b = parseISO(toISO).getTime();
  const d = Math.round((b - a) / MS_DAY) + 1;
  return Math.max(1, d);
}

function safeNum(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isCountedSession(a: Activity): boolean {
  if (!a) return false;
  if (a.type === "rest") return false;
  const dur = a.durationMin ?? 0;
  return dur > 0;
}

function sportFactor(a: Activity): number {
  const s = a.sport;
  if (s === "trail") return 1.15;
  if (s === "hike") return 0.85;
  if (s === "walk") return 0.65;
  if (s.startsWith("bike")) return 0.7;
  if (s === "swim") return 0.75;
  if (s === "strength") return 0.9;
  return 1.0;
}

/**
 * Charge simple (stable, explicable)
 * - minutes * RPE (fallback 5) * facteur sport
 */
export function activityLoad(a: Activity): number {
  const dur = safeNum(a.durationMin);
  const rpe = clamp(safeNum(a.rpe) || 5, 1, 10);
  return dur * rpe * sportFactor(a);
}

function inRangeISO(dateISO: string, fromISO: string, toISO: string): boolean {
  return dateISO >= fromISO && dateISO <= toISO;
}

/* ----------------------------- ISO week helpers ---------------------------- */
/**
 * ISO week algorithm
 * - Monday as first day
 * - week 1 is the week containing Jan 4
 */

function isoDayOfWeek(d: Date): number {
  // 1..7 (Mon..Sun)
  const js = d.getDay(); // 0..6 (Sun..Sat)
  return js === 0 ? 7 : js;
}

export function startOfISOWeek(iso: string): Date {
  const d = parseISO(iso);
  const dow = isoDayOfWeek(d);
  d.setDate(d.getDate() - (dow - 1)); // to Monday
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isoWeekKeyFromDate(iso: string): { weekKey: string; weekYear: number; weekNo: number } {
  const d = parseISO(iso);
  d.setHours(0, 0, 0, 0);

  // Thursday in current week determines year
  const dow = isoDayOfWeek(d);
  d.setDate(d.getDate() + (4 - dow));

  const weekYear = d.getFullYear();

  // week 1: week containing Jan 4
  const jan4 = new Date(weekYear, 0, 4);
  jan4.setHours(0, 0, 0, 0);
  const jan4Dow = isoDayOfWeek(jan4);
  jan4.setDate(jan4.getDate() + (4 - jan4Dow)); // Thursday of week 1

  const diff = d.getTime() - jan4.getTime();
  const weekNo = 1 + Math.round(diff / (7 * MS_DAY));

  const weekKey = `${weekYear}-W${String(weekNo).padStart(2, "0")}`;
  return { weekKey, weekYear, weekNo };
}

/* ------------------------------- range bounds ------------------------------ */

export function rangeBounds(range: RangeKey, allMinDate?: string): { fromISO: string; toISO: string } {
  const toISO = isoToday();
  if (range === "all") return { fromISO: allMinDate ?? addDaysISO(toISO, -365), toISO };
  if (range === "12w") return { fromISO: addDaysISO(toISO, -(12 * 7 - 1)), toISO };
  if (range === "28d") return { fromISO: addDaysISO(toISO, -27), toISO };
  return { fromISO: addDaysISO(toISO, -6), toISO };
}

/* ----------------------------- aggregate builders -------------------------- */

function sum(arr: number[]) {
  let s = 0;
  for (const x of arr) s += x;
  return s;
}

function computeSummary(fromISO: string, toISO: string, list: Activity[], allListForLoad: Activity[]) {
  const days = diffDaysInclusive(fromISO, toISO);

  const counted = list.filter(isCountedSession);

  const distanceKm = sum(counted.map((a) => safeNum(a.distanceKm)));
  const durationMin = sum(counted.map((a) => safeNum(a.durationMin)));
  const elevationGainM = sum(counted.map((a) => safeNum(a.elevationGainM)));
  const sessions = counted.length;

  // Loads always computed from "all" recent data for gauges stability
  const to = isoToday();
  const from7 = addDaysISO(to, -6);
  const from28 = addDaysISO(to, -27);

  const last7 = allListForLoad.filter((a) => inRangeISO(a.date, from7, to) && isCountedSession(a));
  const last28 = allListForLoad.filter((a) => inRangeISO(a.date, from28, to) && isCountedSession(a));

  const acute7d = sum(last7.map(activityLoad));
  const chronic28d = sum(last28.map(activityLoad));
  const chronicWeekly = chronic28d / 4;

  const ratio = chronicWeekly > 0 ? acute7d / chronicWeekly : acute7d > 0 ? 1.25 : 1.0;

  const weeks = Math.max(1, days / 7);

  return {
    fromISO,
    toISO,
    days,

    sessions,
    distanceKm,
    durationMin,
    elevationGainM,

    avgPerWeek: {
      sessions: sessions / weeks,
      distanceKm: distanceKm / weeks,
      durationMin: durationMin / weeks,
      elevationGainM: elevationGainM / weeks,
      load: sum(counted.map(activityLoad)) / weeks,
    },

    load: {
      acute7d,
      chronic28d,
      chronicWeekly,
      ratio,
    },
  } satisfies Summary;
}

function computeGaugesFromLoad(load: Summary["load"], allList: Activity[]): Gauge[] {
  const ratio = load.ratio;

  const to = isoToday();
  const from7 = addDaysISO(to, -6);
  const last7 = allList.filter((a) => inRangeISO(a.date, from7, to) && isCountedSession(a));
  const activeDays = new Set(last7.map((x) => x.date)).size;
  const consistencyBonus = clamp((activeDays - 2) * 4, 0, 16);

  const charge = clamp(55 + (ratio - 1) * 35, 0, 100);
  const fatigue = clamp(35 + (ratio - 1) * 55, 0, 100);
  const forme = clamp(72 - (ratio - 1) * 45 + consistencyBonus, 0, 100);

  const chargeTone: Gauge["tone"] = charge >= 80 ? "red" : charge >= 65 ? "orange" : "slate";
  const fatigueTone: Gauge["tone"] = fatigue >= 80 ? "red" : fatigue >= 60 ? "orange" : "slate";
  const formeTone: Gauge["tone"] = forme >= 70 ? "green" : forme >= 55 ? "slate" : "orange";

  const chargeHint =
    ratio >= 1.2
      ? "Pic récent. Simplifie 24–48h."
      : ratio <= 0.85
      ? "Charge en baisse. Bien pour récupérer."
      : "Stable. Continue sans forcer.";

  const fatigueHint =
    ratio >= 1.2
      ? "Risque de surcharge. Coupe un peu le volume."
      : ratio >= 1.05
      ? "Surveille le sommeil et la récupération."
      : "Pas d’alerte. Garde du confort.";

  const formeHint =
    forme >= 70 ? "Bonne marge. Tu peux tenir le plan." : forme >= 55 ? "Correct. Reste régulier." : "Un peu bas. Priorité: repos/EF.";

  return [
    { label: "Forme", value: forme, tone: formeTone, hint: formeHint },
    { label: "Fatigue", value: fatigue, tone: fatigueTone, hint: fatigueHint },
    { label: "Charge", value: charge, tone: chargeTone, hint: chargeHint },
  ];
}

function computeWeeklySeries(fromISO: string, toISO: string, list: Activity[]): WeeklyPoint[] {
  // map weekKey -> aggregate
  const map = new Map<string, WeeklyPoint>();

  for (const a of list) {
    if (!inRangeISO(a.date, fromISO, toISO)) continue;

    const { weekKey } = isoWeekKeyFromDate(a.date);

    const monday = startOfISOWeek(a.date);
    const startISO = toISO(monday);
    const endISO = toISO(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));

    const prev =
      map.get(weekKey) ??
      ({
        weekKey,
        startISO,
        endISO,
        sessions: 0,
        distanceKm: 0,
        durationMin: 0,
        elevationGainM: 0,
        load: 0,
      } satisfies WeeklyPoint);

    const counted = isCountedSession(a);

    prev.sessions += counted ? 1 : 0;
    prev.distanceKm += safeNum(a.distanceKm);
    prev.durationMin += safeNum(a.durationMin);
    prev.elevationGainM += safeNum(a.elevationGainM);
    prev.load += counted ? activityLoad(a) : 0;

    map.set(weekKey, prev);
  }

  // ensure continuity: include empty weeks between bounds
  const startMonday = startOfISOWeek(fromISO);
  const endMonday = startOfISOWeek(toISO);

  const points: WeeklyPoint[] = [];
  const cur = new Date(startMonday.getTime());
  while (cur.getTime() <= endMonday.getTime()) {
    const curISO = toISO(cur);
    const { weekKey } = isoWeekKeyFromDate(curISO);
    const startISO = toISO(cur);
    const endISO = toISO(new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 6));

    const existing = map.get(weekKey);
    points.push(
      existing ??
        ({
          weekKey,
          startISO,
          endISO,
          sessions: 0,
          distanceKm: 0,
          durationMin: 0,
          elevationGainM: 0,
          load: 0,
        } satisfies WeeklyPoint)
    );

    cur.setDate(cur.getDate() + 7);
  }

  // sort asc by startISO
  points.sort((a, b) => (a.startISO < b.startISO ? -1 : a.startISO > b.startISO ? 1 : 0));
  return points;
}

/* --------------------------------- public -------------------------------- */

/**
 * Compute stats from a list (pure)
 * - utile pour tests
 */
export function computeStatsFromActivities(range: RangeKey, all: Activity[]): ComputeResult {
  const dates = all.map((a) => a.date).filter(Boolean);
  let allMinDate: string | undefined;
  if (dates.length) {
    dates.sort();
    allMinDate = dates[0];
  }

  const { fromISO, toISO } = rangeBounds(range, allMinDate);

  const activitiesInRange = all.filter((a) => inRangeISO(a.date, fromISO, toISO));
  const summary = computeSummary(fromISO, toISO, activitiesInRange, all);
  const gauges = computeGaugesFromLoad(summary.load, all);
  const weeks = computeWeeklySeries(fromISO, toISO, activitiesInRange);

  return { range, fromISO, toISO, summary, gauges, weeks, activitiesInRange };
}

/**
 * Compute stats (fetch storage)
 */
export async function computeStats(range: RangeKey): Promise<ComputeResult> {
  const all = await listActivities();
  return computeStatsFromActivities(range, all);
}

/**
 * Helpers: formatters (pour l’UI)
 */

export function fmtDistanceKm(km: number): string {
  const v = Number.isFinite(km) ? km : 0;
  if (v <= 0) return "0 km";
  if (v < 10) return `${v.toFixed(1).replace(".", ",")} km`;
  return `${Math.round(v)} km`;
}

export function fmtHoursMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(Number.isFinite(totalMinutes) ? totalMinutes : 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h ${String(r).padStart(2, "0")}`;
}

export function fmtElevation(m: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(m) ? m : 0));
  return `${v.toLocaleString("fr-FR")} m`;
}
