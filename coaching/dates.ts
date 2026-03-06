// coaching/dates.ts
/**
 * Utilitaires dates (safe RN + Web)
 * Objectifs :
 * - ISO local "YYYY-MM-DD" sans pièges UTC
 * - parsing ISO en Date locale
 * - helpers semaine (lundi), labels FR
 * - robustesse DST (changement d'heure) via "midday anchor"
 */

const DOW_FR_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."] as const;
const DOW_FR_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && Math.floor(n) === n;
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function daysInMonth(year: number, month1to12: number) {
  // month1to12: 1..12
  // new Date(y, m, 0) => dernier jour du mois m (1..12) en JS
  return new Date(year, month1to12, 0).getDate();
}

function isValidISODateString(iso: string) {
  return /^(\d{4})-(\d{2})-(\d{2})$/.test(String(iso ?? "").trim());
}

/**
 * Retourne une Date locale ancrée à midi (12:00) pour éviter les pièges DST.
 * (À minuit, certaines journées "sautent" ou se répètent selon la zone.)
 */
function makeLocalMidday(year: number, monthIndex0: number, day: number) {
  return new Date(year, monthIndex0, day, 12, 0, 0, 0);
}

/** Date locale -> "YYYY-MM-DD" (local) */
export function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

/** Alias rétro-compat si tu avais déjà toISODate() partout */
export const toISODate = toISODateLocal;

/**
 * Parse ISO "YYYY-MM-DD" -> Date locale (00:00:00.000)
 * ⚠️ On n'utilise pas Date.parse("YYYY-MM-DD") car web => UTC => décalage possible.
 *
 * Comportement:
 * - ISO invalide => 1970-01-01
 * - Jour hors mois => clamp au dernier jour du mois (ex: 2026-02-31 => 2026-02-28)
 */
export function parseISODateLocal(iso: string): Date {
  const raw = String(iso ?? "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date(1970, 0, 1, 0, 0, 0, 0);

  const y = clampInt(Number(m[1]), 1900, 2100);
  const mo = clampInt(Number(m[2]), 1, 12);
  const maxDay = daysInMonth(y, mo);
  const dd = clampInt(Number(m[3]), 1, maxDay);

  // on renvoie minuit local (utile pour affichage / UI)
  return new Date(y, mo - 1, dd, 0, 0, 0, 0);
}

/**
 * Variante “safe” : renvoie null si iso invalide (au lieu de 1970).
 * Pratique quand tu veux distinguer "pas de date" vs "date par défaut".
 */
export function tryParseISODateLocal(iso: string): Date | null {
  if (!isValidISODateString(iso)) return null;
  const d = parseISODateLocal(iso);
  // re-check: si iso était "2026-02-31", on la clamp. On considère ça valide mais normalisé.
  return d;
}

/** "YYYY-MM-DD" + N jours => "YYYY-MM-DD" (local, robuste DST) */
export function addDaysISO(iso: string, days: number): string {
  const base = parseISODateLocal(iso);
  // anchor à midi pour éviter DST
  const d = makeLocalMidday(base.getFullYear(), base.getMonth(), base.getDate());
  const delta = Number.isFinite(days) ? Math.trunc(days) : 0;
  d.setDate(d.getDate() + delta);
  return toISODateLocal(d);
}

/**
 * Diff en jours entre 2 ISO (b - a), robuste DST.
 * Exemple: diffDaysISO("2026-01-01","2026-01-03") = 2
 */
export function diffDaysISO(aISO: string, bISO: string): number {
  const a0 = parseISODateLocal(aISO);
  const b0 = parseISODateLocal(bISO);

  const a = makeLocalMidday(a0.getFullYear(), a0.getMonth(), a0.getDate()).getTime();
  const b = makeLocalMidday(b0.getFullYear(), b0.getMonth(), b0.getDate()).getTime();

  // maintenant, la diff en ms est stable même sur DST
  return Math.round((b - a) / 86400000);
}

/**
 * 0..6 = Lun..Dim
 * (JS getDay(): Dim=0, Lun=1 ... Sam=6)
 */
export function dowIndexFromDateLocal(d: Date): number {
  const js = d.getDay(); // 0..6 (Dim..Sam)
  return js === 0 ? 6 : js - 1;
}

/** 0..6 = Lun..Dim à partir d’un ISO */
export function dowIndexFromISO(iso: string): number {
  return dowIndexFromDateLocal(parseISODateLocal(iso));
}

/**
 * Retourne le lundi de la semaine contenant `now` (en ISO local).
 * (Ancré à midi pour DST)
 */
export function getMondayISO(now: Date = new Date()): string {
  const base = makeLocalMidday(now.getFullYear(), now.getMonth(), now.getDate());
  const js = base.getDay();
  const offset = js === 0 ? -6 : 1 - js; // ramène à lundi
  base.setDate(base.getDate() + offset);
  return toISODateLocal(base);
}

/** ISO local "aujourd’hui" */
export function todayISO(): string {
  return toISODateLocal(new Date());
}

/**
 * Retourne le start ISO (lundi) d'une semaine à partir d'un ISO quelconque de la semaine.
 * Ex: weekStartFromISO("2026-01-28") => lundi correspondant
 */
export function weekStartFromISO(iso: string): string {
  const idx = dowIndexFromISO(iso); // 0..6
  return addDaysISO(iso, -idx);
}

/** Lundi suivant (si iso est un lundi, renvoie le lundi d'après) */
export function nextMondayISO(fromISO: string): string {
  const start = weekStartFromISO(fromISO);
  return addDaysISO(start, 7);
}

/** "lun. 24/01" */
export function formatDateFRShort(iso: string): string {
  const dt = parseISODateLocal(iso);
  const dow = DOW_FR_SHORT[dowIndexFromDateLocal(dt)] ?? "";
  const dd = pad2(dt.getDate());
  const mm = pad2(dt.getMonth() + 1);
  return `${dow} ${dd}/${mm}`;
}

/** "Lundi 24/01" */
export function formatDateFRLong(iso: string): string {
  const dt = parseISODateLocal(iso);
  const dow = DOW_FR_LONG[dowIndexFromDateLocal(dt)] ?? "";
  const dd = pad2(dt.getDate());
  const mm = pad2(dt.getMonth() + 1);
  return `${dow} ${dd}/${mm}`;
}

/** "Semaine du lun. 24/01" */
export function formatWeekLabelFR(weekStartISO: string): string {
  return `Semaine du ${formatDateFRShort(weekStartISO)}`;
}

/** Utilitaire: normalise un ISO (clamp jour/mois) -> ISO */
export function normalizeISO(iso: string): string {
  return toISODateLocal(parseISODateLocal(iso));
}

/** Utilitaire: validation simple sans normalisation */
export function isISODate(iso: string): boolean {
  return isValidISODateString(iso);
}

/** Bonus: compare ISO (a < b ? -1 : 1) sans Date.parse UTC */
export function compareISO(aISO: string, bISO: string): number {
  // Comme format YYYY-MM-DD => comparaison lexicographique OK si valide
  const a = String(aISO ?? "").trim();
  const b = String(bISO ?? "").trim();
  if (a === b) return 0;
  if (isValidISODateString(a) && isValidISODateString(b)) return a < b ? -1 : 1;

  // fallback robuste
  const da = parseISODateLocal(aISO);
  const db = parseISODateLocal(bISO);
  return da.getTime() < db.getTime() ? -1 : 1;
}
