// coaching/days.ts
// Canonique : Lun=0 … Dim=6
// Objectifs :
// - normalisation tolérante (IA-friendly) FR/EN + accents + ponctuation
// - helpers UI FR (court + long)
// - conversions sûres (guard + unique + tri)
// - planification (daysUntil, nextOccurrence, rotate, ensureCount)
// - week mask (7 bits) pour stockage compact

export const DOW = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
} as const;

export type DowKey = keyof typeof DOW;
export type DowIndex = (typeof DOW)[DowKey]; // 0..6

const KEYS: readonly DowKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const LABEL_FR_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;
const LABEL_FR_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

/* -------------------------------- utils --------------------------------- */

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Math.floor(n) === n;
}

function inRange0to6(n: number) {
  return n >= 0 && n <= 6;
}

function guardDow(n: unknown): DowIndex | undefined {
  if (!isInt(n)) return undefined;
  if (!inRange0to6(n)) return undefined;
  return n as DowIndex;
}

function uniqSorted(nums: readonly number[]) {
  const s = new Set<number>();
  for (const n of nums) {
    if (isInt(n) && inRange0to6(n)) s.add(n);
  }
  return Array.from(s).sort((a, b) => a - b);
}

function stripAccents(s: string) {
  // NFD sépare accents, puis on supprime les marques diacritiques
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Nettoyage agressif: lower + accents + remove spaces/punct */
function normalizeToken(input: string) {
  return stripAccents(String(input ?? ""))
    .toLowerCase()
    .trim()
    .replace(/[\s._-]+/g, "") // espaces + separateurs fréquents
    .replace(/[^\p{L}\p{N}]/gu, ""); // supprime le reste (unicode safe)
}

/* ----------------------------- core mapping ------------------------------ */

/** 0..6 → "mon" | ... */
export function dowToKey(dow: number): DowKey | undefined {
  const d = guardDow(dow);
  return d === undefined ? undefined : KEYS[d];
}

/** "mon" → 0..6 */
export function keyToDow(key: DowKey): DowIndex {
  return DOW[key];
}

/** 0..6 → "Lun" | ... */
export function dowToLabelFR(dow: number): string {
  const d = guardDow(dow);
  return d === undefined ? "—" : (LABEL_FR_SHORT[d] ?? "—");
}

/** 0..6 → "Lundi" | ... */
export function dowToLabelFRLong(dow: number): string {
  const d = guardDow(dow);
  return d === undefined ? "—" : (LABEL_FR_LONG[d] ?? "—");
}

/**
 * ISO weekday: Mon=1..Sun=7
 * (utile pour APIs ISO)
 */
export function dowToIso(dow: number): number | undefined {
  const d = guardDow(dow);
  return d === undefined ? undefined : d + 1;
}

export function isoToDow(iso: number): DowIndex | undefined {
  if (!isInt(iso) || iso < 1 || iso > 7) return undefined;
  return (iso - 1) as DowIndex;
}

/**
 * Transforme ["mon","thu"] -> [0,3] (unique + tri)
 */
export function preferredDaysToDow(preferred?: readonly DowKey[]): DowIndex[] | undefined {
  if (!preferred?.length) return undefined;
  const out = preferred.map((k) => DOW[k]);
  const res = uniqSorted(out) as DowIndex[];
  return res.length ? res : undefined;
}

/* ------------------------- tolerant normalization ------------------------ */

/**
 * Mapping tolérant (FR/EN) :
 * - accepte "lun", "lundi", "LUN.", "jeud", "Jeudi", "thurs", "tuesday", "wedn", etc.
 * - accepte variantes courtes/longues
 * - accents/ponctuation ignorés
 *
 * Règle: on matche d'abord des préfixes fiables.
 */
export function normalizeDayStringToDow(input: string): DowIndex | undefined {
  const v = normalizeToken(input);
  if (!v) return undefined;

  // --- EN ---
  // monday
  if (v === "monday" || v.startsWith("mon")) return 0;
  // tuesday
  if (v === "tuesday" || v.startsWith("tue") || v.startsWith("tues")) return 1;
  // wednesday
  if (v === "wednesday" || v.startsWith("wed") || v.startsWith("weds")) return 2;
  // thursday
  if (v === "thursday" || v.startsWith("thu") || v.startsWith("thur") || v.startsWith("thurs")) return 3;
  // friday
  if (v === "friday" || v.startsWith("fri")) return 4;
  // saturday
  if (v === "saturday" || v.startsWith("sat")) return 5;
  // sunday
  if (v === "sunday" || v.startsWith("sun")) return 6;

  // --- FR (court + long + petites fautes) ---
  // lundi
  if (v === "lundi" || v.startsWith("lun")) return 0;
  // mardi
  if (v === "mardi" || v.startsWith("mar")) return 1;
  // mercredi
  if (v === "mercredi" || v.startsWith("mer")) return 2;
  // jeudi (jeud / jeu)
  if (v === "jeudi" || v.startsWith("jeu") || v.startsWith("jeud")) return 3;
  // vendredi
  if (v === "vendredi" || v.startsWith("ven") || v.startsWith("vend")) return 4;
  // samedi
  if (v === "samedi" || v.startsWith("sam")) return 5;
  // dimanche
  if (v === "dimanche" || v.startsWith("dim")) return 6;

  return undefined;
}

/**
 * Normalise une liste de jours, input mixte:
 * - DowKey[] ("mon")
 * - number[] (0..6)
 * - string[] ("Lundi", "thu", etc.)
 *
 * => unique + tri (0..6)
 */
export function normalizeDays(input?: readonly (DowKey | number | string)[]): DowIndex[] | undefined {
  if (!input?.length) return undefined;

  const out: number[] = [];
  for (const v of input) {
    if (typeof v === "number") {
      out.push(v);
    } else if (typeof v === "string") {
      const d = normalizeDayStringToDow(v);
      if (d !== undefined) out.push(d);
    } else {
      out.push(DOW[v]);
    }
  }

  const res = uniqSorted(out) as DowIndex[];
  return res.length ? res : undefined;
}

/* -------------------------- planning / misc ------------------------------ */

/**
 * Delta (0..6) entre todayDow -> targetDow
 * Ex: today=Mar(1), target=Jeu(3) => 2
 * Ex: today=Mar(1), target=Mar(1) => 0
 */
export function daysUntilDow(todayDow: number, targetDow: number): number | undefined {
  const t = guardDow(todayDow);
  const g = guardDow(targetDow);
  if (t === undefined || g === undefined) return undefined;
  return (g - t + 7) % 7;
}

/**
 * Prochain jour d'entraînement à partir de todayDow (inclus si same day).
 * Ex:
 * - days=[1,3,6], today=1 => 1
 * - days=[1,3,6], today=2 => 3
 * - days=[1,3,6], today=6 => 6
 * - days=[1,3,6], today=0 => 1
 */
export function nextDowFrom(todayDow: number, dows?: readonly number[]): DowIndex | undefined {
  const t = guardDow(todayDow);
  const list = normalizeDays(dows as any);
  if (t === undefined || !list?.length) return undefined;

  for (let k = 0; k < 7; k++) {
    const cand = ((t + k) % 7) as DowIndex;
    if (list.includes(cand)) return cand;
  }
  return undefined;
}

/**
 * Rotation d’une liste de jours (ex: pour UI: commencer au lundi courant)
 * rotate([3,5,0], start=3) => [3,5,0]
 * rotate([3,5,0], start=0) => [0,3,5]
 */
export function rotateDows(dows: readonly number[], startDow: number): DowIndex[] {
  const list = normalizeDays(dows as any) ?? [];
  const s = guardDow(startDow);
  if (!list.length || s === undefined) return list;

  const left: DowIndex[] = [];
  const right: DowIndex[] = [];
  for (const d of list) {
    if (d >= s) right.push(d);
    else left.push(d);
  }
  return [...right, ...left];
}

/**
 * Assure exactement N jours (utile onboarding quand sessionsPerWeek change)
 * - unique + tri
 * - si trop: tronque
 * - si pas assez: complète avec un ordre “raisonnable” (proche des midweek)
 */
export function ensureDaysCount(dows: readonly number[], targetCount: number, defaultDow: DowIndex = 1): DowIndex[] {
  const n = isInt(targetCount) ? Math.max(1, Math.min(7, targetCount)) : 1;
  let list = normalizeDays(dows as any) ?? [];
  list = list.slice(0, n);

  if (list.length === 0) list = [defaultDow];

  if (list.length < n) {
    const set = new Set<number>(list);
    const candidates: DowIndex[] = [defaultDow, 3, 5, 0, 2, 4, 6];
    for (const c of candidates) {
      if (set.size >= n) break;
      set.add(c);
    }
    list = uniqSorted(Array.from(set)) as DowIndex[];
    list = list.slice(0, n);
  }

  return list;
}

/* ------------------------------ week mask -------------------------------- */

/**
 * Mask 7 bits: bit0=Lun ... bit6=Dim
 */
export function dowsToMask(dows?: readonly number[]): number {
  const clean = uniqSorted([...(dows ?? [])]);
  let mask = 0;
  for (const d of clean) mask |= 1 << d;
  return mask;
}

export function maskToDows(mask: number): DowIndex[] {
  if (!isInt(mask) || mask < 0) return [];
  const out: number[] = [];
  for (let d = 0; d < 7; d++) {
    if ((mask & (1 << d)) !== 0) out.push(d);
  }
  return out as DowIndex[];
}

/**
 * String utile debug / logs / IA:
 * maskToKeyString(0b0010101) => "mon wed fri"
 */
export function maskToKeyString(mask: number): string {
  const dows = maskToDows(mask);
  return dows.map((d) => KEYS[d]).join(" ");
}

/**
 * Parse un string "mon wed fri" / "lun mer ven" / "monday,thursday"
 * et renvoie un mask.
 */
export function keyStringToMask(input: string): number {
  const tokens = String(input ?? "")
    .split(/[,\s;|/]+/g)
    .map((t) => t.trim())
    .filter(Boolean);

  const dows: number[] = [];
  for (const t of tokens) {
    // try direct key
    const v = normalizeToken(t);
    const asKey = (KEYS as readonly string[]).includes(v) ? (v as DowKey) : null;

    if (asKey) dows.push(DOW[asKey]);
    else {
      const d = normalizeDayStringToDow(t);
      if (d !== undefined) dows.push(d);
    }
  }

  return dowsToMask(dows);
}
