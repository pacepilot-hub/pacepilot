// storage/validators.ts

/**
 * Validators runtime (bêta)
 * - Centralise les garde-fous sur les données venant du JSON (AsyncStorage / API)
 * - Fonctions pures, sans dépendance
 * - "Sceptique" par défaut : on préfère refuser que deviner
 */

/* --------------------------------- basics -------------------------------- */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function safeStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function nonEmptyStr(v: unknown): string | null {
  const s = safeStr(v);
  return s.length ? s : null;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  const x = Math.round(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export function safeNum(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function safeInt(v: unknown): number | undefined {
  const n = safeNum(v);
  return n === undefined ? undefined : Math.round(n);
}

export function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* --------------------------------- dates --------------------------------- */

const ISO_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" strict (sans timezone) */
export function isISODateYMD(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!ISO_YMD_RE.test(s)) return false;

  const [y, m, d] = s.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;

  // check calendrier réel (évite 2026-02-31)
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/**
 * ISO complet tolérant (ex: toISOString()).
 * ⚠️ Ne garantit pas "Z" ou timezone, juste parseable par Date.
 */
export function isISODateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!s) return false;
  const d = new Date(s);
  return Number.isFinite(d.getTime());
}

/**
 * Parse safe "YYYY-MM-DD" en date locale (midi) pour éviter bug UTC :
 * new Date("YYYY-MM-DD") => UTC => décale parfois.
 */
export function parseISODateYMDToLocalDate(iso: string): Date | null {
  if (!isISODateYMD(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

/* --------------------------------- arrays -------------------------------- */

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/* --------------------------------- enums --------------------------------- */

export function isOneOf<const T extends readonly string[]>(
  value: unknown,
  list: T
): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/* --------------------------------- ids ----------------------------------- */

export function looksLikeId(v: unknown, minLen = 3): v is string {
  const s = safeStr(v);
  return s.length >= minLen;
}

/* ------------------------------- numbers ui ------------------------------- */

export function sanitizeOptionalNumber(v: unknown, opts: { min: number; max: number; int?: boolean }) {
  const n = safeNum(v);
  if (n === undefined) return undefined;
  const x = opts.int ? Math.round(n) : n;
  if (!Number.isFinite(x)) return undefined;
  return clamp(x, opts.min, opts.max);
}

/* ------------------------------- route tuples ----------------------------- */

/** RoutePoint = [lat, lon] */
export type RoutePoint = readonly [number, number];

export function isRoutePoint(v: unknown): v is RoutePoint {
  if (!Array.isArray(v) || v.length !== 2) return false;
  const lat = v[0];
  const lon = v[1];
  if (typeof lat !== "number" || !Number.isFinite(lat)) return false;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lon < -180 || lon > 180) return false;
  return true;
}

/* --------------------------------- helpers -------------------------------- */

/**
 * Gardien générique pour payloads storage :
 * - si c'est un array -> ok
 * - sinon -> []
 */
export function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/**
 * Gardien générique pour string non vide (sinon fallback)
 */
export function strOr(v: unknown, fallback: string): string {
  return nonEmptyStr(v) ?? fallback;
}

/* -------------------------- domain-specific guards ------------------------- */
/**
 * Ici tu peux ajouter des validateurs "métier" sans importer tes types,
 * pour éviter les dépendances circulaires (storage -> coaching -> storage).
 *
 * Exemple:
 * - isDowIndex (0..6)
 * - isRPE (1..10)
 * - isHr (30..240)
 */

export type DowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export function isDowIndex(v: unknown): v is DowIndex {
  return Number.isInteger(v) && v >= 0 && v <= 6;
}

export function sanitizeDowIndex(v: unknown, fallback: DowIndex = 0): DowIndex {
  return isDowIndex(v) ? v : fallback;
}

export function isRPE(v: unknown): v is number {
  return Number.isInteger(v) && v >= 1 && v <= 10;
}

export function sanitizeRPE(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = safeInt(v);
  if (n === undefined) return undefined;
  return clamp(n, 1, 10);
}

export function sanitizeHr(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = safeInt(v);
  if (n === undefined) return undefined;
  return clamp(n, 30, 240);
}

export function sanitizeDistanceKm(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = safeNum(v);
  if (n === undefined) return undefined;
  return clamp(n, 0, 1000);
}

export function sanitizeDurationMin(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = safeNum(v);
  if (n === undefined) return undefined;
  return clamp(n, 0, 24 * 60);
}


