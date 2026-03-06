// storage/metrics.ts
import type { Activity } from "@/storage/types";
import { activityLoad } from "@/coaching/mappers";
import { toISODateLocal, parseISODateLocal, addDaysISO, diffDaysISO } from "@/coaching/dates";

export type LoadPoint = {
  idx: number;
  load: number;
  atl: number;
  ctl: number;
  tsb: number;
  dayKey?: string; // YYYY-MM-DD local
  timeMs?: number; // début du jour (local)
};

type SeriesOpts = {
  assumeSorted?: boolean;
  atlDays?: number; // 7
  ctlDays?: number; // 42
  clampLoad?: { min?: number; max?: number };
  dropUnknownDate?: boolean;

  /** NEW: si true, injecte les jours manquants avec load=0 (recommandé pour graph) */
  fillMissingDays?: boolean;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** EWMA : alpha = 2/(N+1) */
function ewma(prev: number, x: number, n: number) {
  const N = Math.max(1, n);
  const alpha = 2 / (N + 1);
  return prev + alpha * (x - prev);
}

function ewmaInit(prev: number | null, x: number, n: number) {
  if (prev === null) return x;
  return ewma(prev, x, n);
}

/* ------------------------------------------------------------------ */
/* Helpers Activity (robustes)                                         */
/* ------------------------------------------------------------------ */

function getActivityTimeMs(a: Activity): number {
  const anyA = a as any;

  const t =
    anyA.startTime ??
    anyA.startedAt ??
    anyA.started_at ??
    anyA.date ??
    anyA.datetime ??
    anyA.createdAt ??
    anyA.created_at ??
    null;

  if (isFiniteNumber(t)) return t;

  if (typeof t === "string") {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : 0;
  }

  const nested = anyA?.start?.dateTime ?? anyA?.start?.timestamp ?? null;
  if (typeof nested === "string") {
    const ms = Date.parse(nested);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (isFiniteNumber(nested)) return nested;

  return 0;
}

function startOfLocalDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayKeyFromDayMs(dayMs: number): string {
  return toISODateLocal(new Date(dayMs));
}

/** Tri chronologique ASC */
export function sortActivitiesChrono(activities: Activity[]): Activity[] {
  return [...activities].sort((a, b) => getActivityTimeMs(a) - getActivityTimeMs(b));
}

/* ------------------------------------------------------------------ */
/* Charge : SOURCE UNIQUE                                              */
/* ------------------------------------------------------------------ */

export function computeSessionLoad(a: Activity): number {
  // ✅ On délègue à la source unique (coaching/mappers.ts)
  const l = activityLoad(a as any);
  return Number.isFinite(l) ? Math.max(0, l) : 0;
}

/* ------------------------------------------------------------------ */
/* Série par jour (recommandé)                                         */
/* ------------------------------------------------------------------ */

export function buildLoadSeriesByDay(activities: Activity[], opts?: SeriesOpts): LoadPoint[] {
  const atlN = opts?.atlDays ?? 7;
  const ctlN = opts?.ctlDays ?? 42;

  const arr = opts?.assumeSorted ? [...activities] : sortActivitiesChrono(activities);

  const clampMin = opts?.clampLoad?.min;
  const clampMax = opts?.clampLoad?.max;

  // group by YYYY-MM-DD local
  const dayLoads = new Map<string, { load: number; dayMs: number }>();

  for (const a of arr) {
    const ms = getActivityTimeMs(a);

    if (!ms) {
      if (opts?.dropUnknownDate) continue;
      continue;
    }

    const dayMs = startOfLocalDayMs(ms);
    const dayKey = dayKeyFromDayMs(dayMs);

    const prev = dayLoads.get(dayKey);
    const nextLoad = (prev?.load ?? 0) + computeSessionLoad(a);

    dayLoads.set(dayKey, { load: nextLoad, dayMs });
  }

  // tri des jours
  let days = Array.from(dayLoads.entries()).sort((a, b) => a[1].dayMs - b[1].dayMs);

  // ✅ OPTION: remplir les jours manquants (load=0) -> graph + EWMA plus lisibles
  if (opts?.fillMissingDays !== false && days.length >= 2) {
    const firstKey = days[0][0];
    const lastKey = days[days.length - 1][0];

    const total = diffDaysISO(firstKey, lastKey);
    const filled: Array<[string, { load: number; dayMs: number }]> = [];

    for (let i = 0; i <= total; i++) {
      const k = addDaysISO(firstKey, i);
      const existing = dayLoads.get(k);
      if (existing) filled.push([k, existing]);
      else {
        const d = parseISODateLocal(k);
        filled.push([k, { load: 0, dayMs: d.getTime() }]);
      }
    }
    days = filled;
  }

  let atl: number | null = null;
  let ctl: number | null = null;

  const out: LoadPoint[] = [];

  days.forEach(([dayKey, v], idx) => {
    let load = Number.isFinite(v.load) ? v.load : 0;

    if (isFiniteNumber(clampMin) || isFiniteNumber(clampMax)) {
      const min = isFiniteNumber(clampMin) ? clampMin : 0;
      const max = isFiniteNumber(clampMax) ? clampMax : 999999;
      load = clamp(load, min, max);
    }

    atl = ewmaInit(atl, load, atlN);
    ctl = ewmaInit(ctl, load, ctlN);

    const tsb = (ctl ?? 0) - (atl ?? 0);

    out.push({
      idx,
      dayKey,
      timeMs: v.dayMs,
      load,
      atl: atl ?? 0,
      ctl: ctl ?? 0,
      tsb,
    });
  });

  return out;
}

/* ------------------------------------------------------------------ */
/* Résumé                                                             */
/* ------------------------------------------------------------------ */

export type LoadTrend = "fatigue_high" | "balanced" | "fresh";

function trendFromTsb(tsb: number): LoadTrend {
  if (tsb < -10) return "fatigue_high";
  if (tsb > 10) return "fresh";
  return "balanced";
}

export function summarizeLoad(series: LoadPoint[]) {
  if (!series.length) return null;

  const last = series[series.length - 1];

  const avgLoad =
    series.reduce((s, p) => s + (Number.isFinite(p.load) ? p.load : 0), 0) / series.length;

  const tail = series.slice(Math.max(0, series.length - 7));
  const tailAvg = tail.reduce((s, p) => s + p.load, 0) / (tail.length || 1);

  return {
    last,
    avgLoad,
    tailAvg,
    trend: trendFromTsb(last.tsb),
  } as const;
}
