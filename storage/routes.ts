// storage/routes.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Routes storage (V2)
 * - Robuste: sanitize au chargement, tolère données sales
 * - Anti-race: mutex (gate) pour upsert/delete/clear
 * - API simple: list / get / upsert / delete / clear
 * - Tri stable: createdAt DESC puis id
 */

export type RouteProfile = "foot-walking" | "foot-hiking";

export type LatLng = {
  latitude: number;
  longitude: number;
};

export type SavedRoute = {
  id: string;
  name: string;
  profile: RouteProfile;
  polyline: LatLng[]; // >= 2 points
  distanceKm: number; // 0..2000
  estimatedTimeMin: number; // 0..1440
  createdAt: number; // epoch ms
  createdBy: "user" | "ai";
};

export type UpsertRouteInput = Partial<Omit<SavedRoute, "id">> & {
  id?: string;
  polyline: LatLng[]; // requis: sinon une route ne sert à rien
};

const KEY = "pacepilot.routes.v2";

/* ---------------------------------- utils --------------------------------- */

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function normStr(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function safeNum(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isProfile(x: unknown): x is RouteProfile {
  return x === "foot-walking" || x === "foot-hiking";
}

function isCreatedBy(x: unknown): x is "user" | "ai" {
  return x === "user" || x === "ai";
}

function sanitizePoint(x: unknown): LatLng | null {
  if (!isObj(x)) return null;
  const lat = safeNum((x as any).latitude);
  const lon = safeNum((x as any).longitude);
  if (lat === undefined || lon === undefined) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: lat, longitude: lon };
}

function sanitizePolyline(x: unknown): LatLng[] | null {
  const arr = Array.isArray(x) ? x : [];
  const out: LatLng[] = [];
  for (const p of arr) {
    const sp = sanitizePoint(p);
    if (sp) out.push(sp);
  }
  return out.length >= 2 ? out : null;
}

function looksLikeSavedRoute(x: unknown): x is SavedRoute {
  if (!isObj(x)) return false;
  return typeof (x as any).id === "string" && Array.isArray((x as any).polyline);
}

function makeId(): string {
  // id stable-ish, sans dépendance externe
  // (si tu préfères: expo-crypto / uuid, on peut remplacer)
  return `route_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Fallback distance/temps si non fournis:
 * - distanceKm: approx via polyline (haversine)
 * - estimatedTimeMin: via pace moyen brut (6:00/km walking-ish)
 */
function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function estimateDistanceKm(polyline: LatLng[]): number {
  let km = 0;
  for (let i = 1; i < polyline.length; i++) {
    km += haversineKm(polyline[i - 1], polyline[i]);
  }
  // anti-extrêmes (données pourries)
  return clamp(km, 0, 2000);
}

function estimateTimeMin(distanceKm: number, profile: RouteProfile): number {
  // heuristique simple:
  // - foot-walking: 6:30/km
  // - foot-hiking: 8:00/km
  const paceMinPerKm = profile === "foot-hiking" ? 8.0 : 6.5;
  const min = distanceKm * paceMinPerKm;
  return clamp(Math.round(min), 0, 24 * 60);
}

function sanitizeRoute(x: unknown): SavedRoute | null {
  if (!isObj(x)) return null;

  const id = normStr((x as any).id);
  const name = normStr((x as any).name);
  const createdAt = safeNum((x as any).createdAt);

  const profileRaw = (x as any).profile;
  const profile: RouteProfile = isProfile(profileRaw) ? profileRaw : "foot-walking";

  const createdByRaw = (x as any).createdBy;
  const createdBy: "user" | "ai" = isCreatedBy(createdByRaw) ? createdByRaw : "user";

  const polyline = sanitizePolyline((x as any).polyline);

  if (!id) return null;
  if (!name) return null;
  if (!Number.isFinite(createdAt)) return null;
  if (!polyline) return null; // <2 points => refuse

  const distanceKmRaw = safeNum((x as any).distanceKm);
  const estimatedTimeMinRaw = safeNum((x as any).estimatedTimeMin);

  const distanceKm =
    distanceKmRaw === undefined ? estimateDistanceKm(polyline) : clamp(distanceKmRaw, 0, 2000);

  const estimatedTimeMin =
    estimatedTimeMinRaw === undefined
      ? estimateTimeMin(distanceKm, profile)
      : clamp(estimatedTimeMinRaw, 0, 24 * 60);

  return {
    id,
    name,
    profile,
    polyline,
    distanceKm,
    estimatedTimeMin,
    createdAt: Math.round(createdAt),
    createdBy,
  };
}

async function readJson(key: string): Promise<unknown | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeAll(routes: SavedRoute[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(routes));
}

/* ------------------------------- gate (mutex) ------------------------------ */

let gate: Promise<void> | null = null;

async function withGate<T>(fn: () => Promise<T>): Promise<T> {
  while (gate) await gate;
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  try {
    return await fn();
  } finally {
    release();
    gate = null;
  }
}

/* ------------------------------ read/sanitize ------------------------------ */

function sortStable(a: SavedRoute, b: SavedRoute) {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

async function readAllSanitized(): Promise<{ list: SavedRoute[]; dirty: boolean }> {
  const parsed = await readJson(KEY);
  if (!Array.isArray(parsed)) return { list: [], dirty: Boolean(parsed) };

  const out: SavedRoute[] = [];
  let dirty = false;

  for (const it of parsed) {
    const r = sanitizeRoute(it);
    if (r) out.push(r);
    else dirty = true;
  }

  out.sort(sortStable);

  if (dirty) await writeAll(out);
  return { list: out, dirty };
}

/* ---------------------------------- API ----------------------------------- */

export async function listRoutes(): Promise<SavedRoute[]> {
  const { list } = await readAllSanitized();
  return list;
}

export async function getRoute(id: string): Promise<SavedRoute | null> {
  const rid = normStr(id);
  if (!rid) return null;
  const { list } = await readAllSanitized();
  return list.find((r) => r.id === rid) ?? null;
}

/**
 * Upsert “souple”:
 * - polyline requise
 * - id optionnel (auto si absent)
 * - name fallback: "Parcours"
 * - createdAt fallback: now
 * - distance/time fallback si manquants
 */
export async function upsertRoute(input: UpsertRouteInput): Promise<SavedRoute> {
  return withGate(async () => {
    const now = Date.now();

    const draft: SavedRoute = {
      id: normStr(input.id) || makeId(),
      name: normStr(input.name) || "Parcours",
      profile: isProfile(input.profile) ? input.profile : "foot-walking",
      polyline: input.polyline, // sanitizeRoute revalide
      distanceKm: safeNum(input.distanceKm) ?? NaN, // NaN => recalcul
      estimatedTimeMin: safeNum(input.estimatedTimeMin) ?? NaN, // NaN => recalcul
      createdAt: safeNum(input.createdAt) ?? now,
      createdBy: isCreatedBy(input.createdBy) ? input.createdBy : "user",
    };

    // Si on a mis NaN volontairement, on supprime les champs pour forcer fallback
    const payload: any = { ...draft };
    if (!Number.isFinite(payload.distanceKm)) delete payload.distanceKm;
    if (!Number.isFinite(payload.estimatedTimeMin)) delete payload.estimatedTimeMin;

    const sanitized = sanitizeRoute(payload);
    if (!sanitized) throw new Error("Invalid route payload.");

    const { list } = await readAllSanitized();
    const idx = list.findIndex((r) => r.id === sanitized.id);

    if (idx >= 0) list[idx] = sanitized;
    else list.push(sanitized);

    list.sort(sortStable);
    await writeAll(list);

    return sanitized;
  });
}

export async function deleteRoute(id: string): Promise<void> {
  return withGate(async () => {
    const rid = normStr(id);
    if (!rid) return;

    const { list } = await readAllSanitized();
    const next = list.filter((r) => r.id !== rid);
    await writeAll(next);
  });
}

export async function clearRoutes(): Promise<void> {
  return withGate(async () => {
    await AsyncStorage.removeItem(KEY);
  });
}

/** Debug utile: reset total toutes versions si tu bump un jour */
export async function clearAllRoutesVersions(): Promise<void> {
  return withGate(async () => {
    await AsyncStorage.multiRemove([
      "pacepilot.routes.v1",
      "pacepilot.routes.v2",
      "pacepilot.routes.v3",
    ]);
  });
}

export const ROUTES_STORAGE_KEY = KEY;
