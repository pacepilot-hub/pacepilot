// services/routeService.ts

export type Waypoint = { lat: number; lng: number };
export type RoutedCoord = { latitude: number; longitude: number };

export type RoutedPath = {
  coords: RoutedCoord[];
  distanceM: number;
  durationS: number;
};

export type RouteProfile = "foot-walking" | "foot-hiking";

type FetchRoutedPathArgs = {
  waypoints: Waypoint[];
  profile: RouteProfile;
  backendUrl?: string;
  timeoutMs?: number;

  /**
   * Retry sur erreurs transitoires (timeout / 5xx / 429 / network)
   * défaut: 1 retry (donc 2 tentatives max)
   */
  retries?: number;

  /** déduplication des requêtes identiques en vol (défaut: true) */
  dedupe?: boolean;

  /**
   * Optionnel: si tu veux annuler depuis un écran
   * (si non fourni, timeout interne fonctionne quand même)
   */
  signal?: AbortSignal;
};

// ⚠️ IMPORTANT : en dev tu peux laisser une IP, mais en vrai -> config (env/extra)
const FALLBACK_BACKEND_URL = "http://192.168.1.18:3333";

/* --------------------------------- helpers -------------------------------- */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isValidLatLng(w: Waypoint) {
  return (
    isFiniteNumber(w.lat) &&
    isFiniteNumber(w.lng) &&
    w.lat >= -90 &&
    w.lat <= 90 &&
    w.lng >= -180 &&
    w.lng <= 180
  );
}

function assertWaypoints(waypoints: Waypoint[]) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error("fetchRoutedPath: need at least 2 waypoints");
  }
  const bad = waypoints.findIndex((w) => !isValidLatLng(w));
  if (bad !== -1) {
    throw new Error(`fetchRoutedPath: invalid waypoint at index ${bad}`);
  }
}

async function safeJson(resp: Response) {
  const text = await resp.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function normalizeUrl(url: string) {
  const s = String(url ?? "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function resolveBackendUrl(override?: string) {
  const base = normalizeUrl(override || FALLBACK_BACKEND_URL);
  if (!base) return normalizeUrl(FALLBACK_BACKEND_URL);
  return base;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function toCoordsKey(waypoints: Waypoint[]) {
  // clé stable simple : arrondi (évite variations flottantes)
  return waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`).join("|");
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const x = isFiniteNumber(n) ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(x)));
}

function safeSnippet(data: unknown, maxLen = 600) {
  try {
    const s = typeof data === "string" ? data : JSON.stringify(data);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return "[unserializable payload]";
  }
}

type ErrKind = "timeout" | "abort" | "http" | "network" | "invalid";

function shouldRetry(kind: ErrKind, status?: number) {
  // retry sur: timeout / network / 5xx / 429
  if (kind === "timeout" || kind === "network") return true;
  if (kind === "http" && status && (status === 429 || (status >= 500 && status <= 599))) return true;
  return false;
}

/* ----------------------- dedupe in-flight requests ------------------------ */

const inflight = new Map<string, Promise<RoutedPath>>();

/* ---------------------------------- main ---------------------------------- */

export async function fetchRoutedPath({
  waypoints,
  profile,
  backendUrl,
  timeoutMs = 12_000,
  retries = 1,
  dedupe = true,
  signal,
}: FetchRoutedPathArgs): Promise<RoutedPath> {
  assertWaypoints(waypoints);

  const baseUrl = resolveBackendUrl(backendUrl);

  const safeTimeout = clampInt(timeoutMs, 3_000, 30_000, 12_000);
  const safeRetries = clampInt(retries, 0, 3, 1);

  const key = dedupe ? `${baseUrl}|${profile}|${toCoordsKey(waypoints)}` : "";

  if (dedupe) {
    const existing = inflight.get(key);
    if (existing) return existing;
  }

  const job = (async (): Promise<RoutedPath> => {
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= safeRetries; attempt++) {
      // merge signal externe + timeout interne
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), safeTimeout);

      const abortListener = () => controller.abort();
      if (signal) signal.addEventListener("abort", abortListener, { once: true });

      try {
        const resp = await fetch(`${baseUrl}/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            coordinates: waypoints,
            profile,
          }),
        });

        const data = await safeJson(resp);

        if (!resp.ok) {
          const msg =
            (data && typeof data === "object" && "error" in data && (data as any).error) ||
            (data && typeof data === "object" && "message" in data && (data as any).message) ||
            `Route fetch failed (${resp.status})`;

          const err = new Error(String(msg));
          lastErr = err;

          if (attempt < safeRetries && shouldRetry("http", resp.status)) {
            await sleep(250 * (attempt + 1));
            continue;
          }

          throw err;
        }

        // Attendu ORS-like
        const feature = (data as any)?.features?.[0];
        const geom = feature?.geometry;
        const summary = feature?.properties?.summary;

        if (!geom || geom.type !== "LineString" || !Array.isArray(geom.coordinates)) {
          const dbg = safeSnippet(data);
          const err = new Error(`Invalid route geometry (expected LineString). Payload: ${dbg}`);
          (err as any).kind = "invalid";
          throw err;
        }

        const coords: RoutedCoord[] = [];
        for (const pair of geom.coordinates as unknown[]) {
          if (!Array.isArray(pair) || pair.length < 2) continue;
          const lng = pair[0];
          const lat = pair[1];
          if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) continue;
          coords.push({ latitude: lat, longitude: lng });
        }

        if (coords.length < 2) {
          throw new Error("Invalid route coordinates (too few points)");
        }

        const distanceM = isFiniteNumber(summary?.distance) ? summary.distance : 0;
        const durationS = isFiniteNumber(summary?.duration) ? summary.duration : 0;

        return { coords, distanceM, durationS };
      } catch (e: any) {
        // Abort / Timeout
        if (e?.name === "AbortError") {
          // distinguer abort externe vs timeout (best-effort)
          const kind: ErrKind = signal?.aborted ? "abort" : "timeout";
          const err =
            kind === "abort"
              ? new Error("Route fetch aborted")
              : new Error(`Route fetch timeout after ${safeTimeout}ms`);

          lastErr = err;

          if (kind !== "abort" && attempt < safeRetries && shouldRetry(kind)) {
            await sleep(250 * (attempt + 1));
            continue;
          }
          throw err;
        }

        // Erreur volontaire "invalid" => ne pas la masquer en "network"
        const kind = (e as any)?.kind as ErrKind | undefined;
        if (kind === "invalid") throw e;

        // Network / other
        const err = new Error(`Route fetch error: ${e?.message ?? "unknown"}`);
        lastErr = err;

        if (attempt < safeRetries && shouldRetry("network")) {
          await sleep(250 * (attempt + 1));
          continue;
        }

        throw err;
      } finally {
        clearTimeout(timeoutId);
        if (signal) signal.removeEventListener("abort", abortListener);
      }
    }

    throw lastErr instanceof Error ? lastErr : new Error("Route fetch failed (unknown)");
  })();

  if (dedupe) inflight.set(key, job);

  try {
    return await job;
  } finally {
    if (dedupe) inflight.delete(key);
  }
}
