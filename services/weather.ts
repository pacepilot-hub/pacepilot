// services/weather.ts
import type { WeatherIcon } from "@/storage/types";

/* --------------------------------- types --------------------------------- */

export type DailyWeather = {
  /** YYYY-MM-DD (dans le timezone demandé à l’API) */
  dateISO: string;

  tMax: number | null;
  tMin: number | null;
  icon: WeatherIcon;

  // coach-ready
  windMaxKmh?: number | null;
  precipMm?: number | null;
};

export type WeeklyWeather = {
  timezone: string;
  days: DailyWeather[]; // 7 jours (objectif)
};

type FetchWeeklyWeatherArgs = {
  lat?: number;
  lon?: number;
  timezone?: string;
  startDate?: Date;

  /** timeout réseau en ms (défaut: 8000) */
  timeoutMs?: number;

  /** retry sur erreurs transitoires (défaut: 1 => 2 tentatives max) */
  retries?: number;

  /** cache TTL (défaut: 20 min) */
  cacheTtlMs?: number;

  /** déduplication des requêtes identiques en vol (défaut: true) */
  dedupe?: boolean;

  /** optionnel: annulation externe (screen/unmount) */
  signal?: AbortSignal;
};

/* -------------------------------- constants ------------------------------ */

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// ⚠️ fallback (Landes / Sud-Ouest) — tu peux le déplacer dans une config
const DEFAULT_LAT = 43.72;
const DEFAULT_LON = -1.05;
const DEFAULT_TZ = "Europe/Paris";

/* -------------------------------- helpers -------------------------------- */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const x = isFiniteNumber(n) ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalISODate(iso: string): Date {
  const [y, m, d] = String(iso).split("-").map((x) => Number(x));
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function addDaysISO(startISO: string, deltaDays: number): string {
  const dt = parseLocalISODate(startISO);
  dt.setDate(dt.getDate() + deltaDays);
  return toLocalISODate(dt);
}

function clampTo7<T>(arr: T[]): T[] {
  return arr.length > 7 ? arr.slice(0, 7) : arr;
}

function asNumOrNull(v: unknown): number | null {
  return isFiniteNumber(v) ? v : null;
}

function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function asNumArray(v: unknown): Array<number | null> {
  return Array.isArray(v) ? v.map(asNumOrNull) : [];
}

function normalizeTimezone(tz: unknown): string {
  const s = String(tz ?? "").trim();
  // garde-fou minimal : évite vide
  return s.length ? s : DEFAULT_TZ;
}

function normalizeLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } {
  const la = isFiniteNumber(lat) ? lat : Number(lat);
  const lo = isFiniteNumber(lon) ? lon : Number(lon);

  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    return { lat: DEFAULT_LAT, lon: DEFAULT_LON };
  }

  // clamp réaliste
  const clampedLat = Math.max(-90, Math.min(90, la));
  const clampedLon = Math.max(-180, Math.min(180, lo));
  return { lat: clampedLat, lon: clampedLon };
}

function iconFromWmo(code: number | null): WeatherIcon {
  if (code == null) return "cloud";

  // soleil / nuages
  if (code === 0) return "sunny";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloud";

  // brouillard
  if (code === 45 || code === 48) return "cloud";

  // pluie / bruine / averses
  if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";

  // neige / grésil : pas d’icône dédiée => cloud (tu pourras ajouter "snow" plus tard)
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "cloud";

  // orages
  if (code >= 95 && code <= 99) return "storm";

  return "cloud";
}

function buildOpenMeteoUrl(params: {
  lat: number;
  lon: number;
  timezone: string;
  startISO: string;
  endISO: string;
}): string {
  const daily =
    "temperature_2m_max,temperature_2m_min,weathercode,windspeed_10m_max,precipitation_sum";

  const q = new URLSearchParams();
  q.set("latitude", String(params.lat));
  q.set("longitude", String(params.lon));
  q.set("daily", daily);
  q.set("timezone", params.timezone);
  q.set("start_date", params.startISO);
  q.set("end_date", params.endISO);

  return `${OPEN_METEO_BASE}?${q.toString()}`;
}

async function safeText(resp: Response) {
  return await resp.text().catch(() => "");
}

async function safeJson(resp: Response) {
  const text = await safeText(resp);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

type ErrKind = "timeout" | "abort" | "http" | "network";

function shouldRetry(kind: ErrKind, status?: number) {
  if (kind === "timeout" || kind === "network") return true;
  if (kind === "http" && status && (status === 429 || (status >= 500 && status <= 599))) return true;
  return false;
}

/* ------------------------------ cache + inflight --------------------------- */

type CacheKey = string;

type CacheEntry = {
  at: number;
  value: WeeklyWeather;
};

const CACHE = new Map<CacheKey, CacheEntry>();
const INFLIGHT = new Map<CacheKey, Promise<WeeklyWeather>>();

function stableKey(args: { lat: number; lon: number; timezone: string; startISO: string }) {
  // arrondi => clé stable, évite spam de cache
  const la = args.lat.toFixed(3);
  const lo = args.lon.toFixed(3);
  return ["v2", `lat:${la}`, `lon:${lo}`, `tz:${args.timezone}`, `start:${args.startISO}`].join("|");
}

function getCached(key: CacheKey, ttlMs: number): WeeklyWeather | null {
  const e = CACHE.get(key);
  if (!e) return null;
  if (Date.now() - e.at > ttlMs) {
    CACHE.delete(key);
    return null;
  }
  return e.value;
}

function setCached(key: CacheKey, value: WeeklyWeather) {
  CACHE.set(key, { at: Date.now(), value });
}

/* -------------------------------- fetch core ------------------------------ */

async function fetchJsonWithRetry(args: {
  url: string;
  timeoutMs: number;
  retries: number;
  signal?: AbortSignal;
}): Promise<unknown> {
  const { url, timeoutMs, retries, signal } = args;

  let lastErr: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const abortListener = () => controller.abort();
    if (signal) signal.addEventListener("abort", abortListener, { once: true });

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        const data = await safeJson(res);
        const msg =
          (data && typeof data === "object" && "error" in data && (data as any).error) ||
          (data && typeof data === "object" && "reason" in data && (data as any).reason) ||
          (data && typeof data === "object" && "message" in data && (data as any).message) ||
          `Weather fetch failed (${res.status})`;

        const err = new Error(String(msg));
        lastErr = err;

        if (attempt < retries && shouldRetry("http", res.status)) {
          await sleep(250 * (attempt + 1));
          continue;
        }

        throw err;
      }

      return await res.json();
    } catch (e: any) {
      // Abort/timeout
      if (e?.name === "AbortError") {
        const kind: ErrKind = signal?.aborted ? "abort" : "timeout";
        const err = kind === "abort" ? new Error("Weather fetch aborted") : new Error(`Weather fetch timeout after ${timeoutMs}ms`);
        lastErr = err;

        if (kind !== "abort" && attempt < retries && shouldRetry(kind)) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw err;
      }

      // Network/other
      const err = new Error(`Weather fetch error: ${e?.message ?? "unknown"}`);
      lastErr = err;

      if (attempt < retries && shouldRetry("network")) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", abortListener);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Weather fetch failed (unknown)");
}

/* --------------------------------- main ---------------------------------- */

/**
 * Récupère 7 jours de météo (daily max/min + weathercode + wind + precip)
 * Source: Open-Meteo
 */
export async function fetchWeeklyWeather(args?: FetchWeeklyWeatherArgs): Promise<WeeklyWeather> {
  const { lat, lon } = normalizeLatLon(args?.lat ?? DEFAULT_LAT, args?.lon ?? DEFAULT_LON);

  const timezone = normalizeTimezone(args?.timezone);
  const startDate = args?.startDate ?? new Date();

  const startISO = toLocalISODate(startDate);
  const endISO = addDaysISO(startISO, 6);

  const timeoutMs = clampInt(args?.timeoutMs, 3_000, 30_000, 8_000);
  const retries = clampInt(args?.retries, 0, 3, 1);
  const cacheTtlMs = clampInt(args?.cacheTtlMs, 3_000, 3_600_000, 20 * 60_000); // 20 min
  const dedupe = args?.dedupe !== false;

  const key = stableKey({ lat, lon, timezone, startISO });

  // 1) cache
  const cached = getCached(key, cacheTtlMs);
  if (cached) return cached;

  // 2) inflight dedupe
  if (dedupe) {
    const inflight = INFLIGHT.get(key);
    if (inflight) return inflight;
  }

  const job = (async () => {
    const url = buildOpenMeteoUrl({ lat, lon, timezone, startISO, endISO });
    const json = await fetchJsonWithRetry({ url, timeoutMs, retries, signal: args?.signal });

    // parsing ultra défensif
    const daily = (json as any)?.daily ?? {};
    const time = clampTo7(asStrArray(daily.time));
    const tMax = clampTo7(asNumArray(daily.temperature_2m_max));
    const tMin = clampTo7(asNumArray(daily.temperature_2m_min));
    const wmo = clampTo7(asNumArray(daily.weathercode));
    const wind = clampTo7(asNumArray(daily.windspeed_10m_max));
    const precip = clampTo7(asNumArray(daily.precipitation_sum));

    const days: DailyWeather[] = [];

    // on vise 7 jours: si time manque, on reconstruit depuis startISO
    const len = Math.max(7, time.length);
    for (let i = 0; i < Math.min(7, len); i++) {
      const dateISO = time[i] ?? addDaysISO(startISO, i);
      days.push({
        dateISO,
        tMax: tMax[i] ?? null,
        tMin: tMin[i] ?? null,
        icon: iconFromWmo((wmo[i] ?? null) as any),
        windMaxKmh: wind[i] ?? null,
        precipMm: precip[i] ?? null,
      });
    }

    const out: WeeklyWeather = { timezone, days };
    setCached(key, out);
    return out;
  })();

  if (dedupe) INFLIGHT.set(key, job);

  try {
    return await job;
  } finally {
    if (dedupe) INFLIGHT.delete(key);
  }
}
