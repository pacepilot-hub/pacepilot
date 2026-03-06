// storage/activities.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Activities storage (V3)
 * - Multi-sport canonical: `sport`
 * - Compat UI: garde `type` historique
 * - Migration: V1 -> V2 -> V3 (douce)
 * - Résilient: data sale => réparée
 * - Gate: queue safe (pas de while busy)
 * - Polyline: cap taille (anti AsyncStorage blowup)
 */

export type ActivityType = "easy" | "intervals" | "tempo" | "long" | "race" | "cross" | "rest";

/**
 * Sport canonical (bêta)
 * - Sert à: UI, coach, filtres, stats, planification multi-sport future
 */
export type Sport =
  | "run"
  | "trail"
  | "bike_road"
  | "bike_mtb"
  | "hike"
  | "swim"
  | "strength"
  | "walk"
  | "other";

/** Nature technique (si tu veux garder la granularité historique) */
export type ActivityKind = "run" | "trail_run" | "hike" | "walk" | "bike" | "other";

/** Provenance */
export type ActivityOrigin = "plan" | "free" | "import";

/** Tags contextuels (coach-ready) */
export type WeatherTag = "normal" | "hot" | "cold" | "rain" | "wind";
export type SleepTag = "bad" | "ok" | "good";
export type StressTag = "low" | "medium" | "high";
export type EnergyTag = "low" | "normal" | "high";

/** Douleur déclarée (prudence, pas diagnostic) */
export type PainLevel = 1 | 2 | 3;
export type Pain = { zone: string; level: PainLevel };

export type ActivityContext = {
  weather?: WeatherTag;
  sleep?: SleepTag;
  stress?: StressTag;
  energy?: EnergyTag;
};

export type Activity = {
  id: string;
  date: string; // YYYY-MM-DD

  /** ✅ Nouveau: sport canonical */
  sport: Sport;

  /** Compat UI */
  type: ActivityType;
  title: string;

  durationMin?: number; // 0..1440
  distanceKm?: number; // 0..1000
  rpe?: number; // 1..10
  avgHr?: number; // 30..240

  elevationGainM?: number; // 0..20000
  routePolyline?: string;

  kind?: ActivityKind; // legacy
  origin?: ActivityOrigin;
  context?: ActivityContext;
  pain?: Pain | null;

  notes?: string;

  createdAt: number;
  updatedAt: number;
};

export type UpsertActivityInput = {
  id: string;
  date: string;
  sport?: Sport; // optionnel en input (on infère si absent)
  type: ActivityType;

  title?: string;

  durationMin?: number;
  distanceKm?: number;
  rpe?: number;
  avgHr?: number;

  elevationGainM?: number;
  routePolyline?: string;

  kind?: ActivityKind;
  origin?: ActivityOrigin;
  context?: ActivityContext;
  pain?: Pain | null;

  notes?: string;

  createdAt?: number;
  updatedAt?: number;
};

/* --------------------------------- keys ---------------------------------- */

const KEY_V1 = "pacepilot.activities.v1";
const KEY_V2 = "pacepilot.activities.v2";
const KEY_V3 = "pacepilot.activities.v3";

/* --------------------------------- utils --------------------------------- */

const ACTIVITY_TYPES: readonly ActivityType[] = [
  "easy",
  "intervals",
  "tempo",
  "long",
  "race",
  "cross",
  "rest",
];

const SPORTS: readonly Sport[] = [
  "run",
  "trail",
  "bike_road",
  "bike_mtb",
  "hike",
  "swim",
  "strength",
  "walk",
  "other",
];

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isActivityType(x: unknown): x is ActivityType {
  return typeof x === "string" && (ACTIVITY_TYPES as readonly string[]).includes(x);
}

function isSport(x: unknown): x is Sport {
  return typeof x === "string" && (SPORTS as readonly string[]).includes(x);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normStr(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function normalizeDate(x: unknown): string | null {
  const s = normStr(x);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeNum(x: unknown): number | undefined {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : undefined;
}

function safeInt(x: unknown): number | undefined {
  const n = safeNum(x);
  return n === undefined ? undefined : Math.round(n);
}

function sortByDateDesc(a: Activity, b: Activity) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return b.updatedAt - a.updatedAt;
}

function inferTitle(type: ActivityType): string {
  switch (type) {
    case "easy":
      return "Footing";
    case "intervals":
      return "Fractionné";
    case "tempo":
      return "Seuil";
    case "long":
      return "Sortie longue";
    case "race":
      return "Course";
    case "cross":
      return "Cross training";
    case "rest":
    default:
      return "Repos";
  }
}

/**
 * 🔥 Important: `sport` est la vérité.
 * - Si l’utilisateur ne fournit pas sport, on infère via kind/type (compat).
 */
function inferSport(input: { sport?: Sport; kind?: ActivityKind; type: ActivityType }): Sport {
  if (input.sport && isSport(input.sport)) return input.sport;

  const k = input.kind;
  if (k === "trail_run") return "trail";
  if (k === "run") return "run";
  if (k === "bike") return "bike_road";
  if (k === "hike") return "hike";
  if (k === "walk") return "walk";

  // fallback via type (compat UI)
  if (input.type === "cross") return "strength";
  if (input.type === "rest") return "other";

  return "run";
}

function sanitizePain(x: unknown): Pain | null {
  if (!isObj(x)) return null;
  const zone = normStr((x as any).zone);
  const level = (x as any).level;
  if (!zone) return null;
  if (level !== 1 && level !== 2 && level !== 3) return null;
  return { zone, level };
}

function sanitizeContext(x: unknown): ActivityContext | undefined {
  if (!isObj(x)) return undefined;

  const weather = normStr((x as any).weather) || undefined;
  const sleep = normStr((x as any).sleep) || undefined;
  const stress = normStr((x as any).stress) || undefined;
  const energy = normStr((x as any).energy) || undefined;

  const out: ActivityContext = {};
  if (weather) out.weather = weather as WeatherTag;
  if (sleep) out.sleep = sleep as SleepTag;
  if (stress) out.stress = stress as StressTag;
  if (energy) out.energy = energy as EnergyTag;

  return Object.keys(out).length ? out : undefined;
}

function safePolyline(x: unknown): string | undefined {
  if (typeof x !== "string") return undefined;
  const s = x.trim();
  if (!s) return undefined;
  if (s.length > 50_000) return undefined; // anti blowup
  return s;
}

/* ----------------------------- storage primitives -------------------------- */

async function readRaw(key: string): Promise<string | null> {
  return await AsyncStorage.getItem(key);
}

async function readJson(key: string): Promise<unknown> {
  const raw = await readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeV3(list: Activity[]) {
  await AsyncStorage.setItem(KEY_V3, JSON.stringify(list));
}

async function hasValidArray(key: string): Promise<boolean> {
  const raw = await readRaw(key);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}

/* ------------------------------- gate (queue) ------------------------------ */

let gate = Promise.resolve();

function withGate<T>(fn: () => Promise<T>): Promise<T> {
  const run = gate.then(fn, fn);
  gate = run.then(() => {}, () => {});
  return run;
}

/* -------------------------- sanitize / migrate items ------------------------ */

function sanitizeV3Item(x: unknown): Activity | null {
  if (!isObj(x)) return null;

  const id = normStr((x as any).id);
  const date = normalizeDate((x as any).date);
  const type = isActivityType((x as any).type) ? ((x as any).type as ActivityType) : null;

  if (!id || !date || !type) return null;

  const now = Date.now();
  const createdAt = safeInt((x as any).createdAt) ?? now;
  const updatedAt = safeInt((x as any).updatedAt) ?? createdAt;

  const title = (() => {
    const t = normStr((x as any).title);
    return t ? t : inferTitle(type);
  })();

  const durationMin = (() => {
    const v = safeInt((x as any).durationMin);
    return v === undefined ? undefined : clamp(v, 0, 24 * 60);
  })();

  const distanceKm = (() => {
    const v = safeNum((x as any).distanceKm);
    return v === undefined ? undefined : clamp(v, 0, 1000);
  })();

  const rpe = (() => {
    const v = safeInt((x as any).rpe);
    return v === undefined ? undefined : clamp(v, 1, 10);
  })();

  const avgHr = (() => {
    const v = safeInt((x as any).avgHr);
    return v === undefined ? undefined : clamp(v, 30, 240);
  })();

  const elevationGainM = (() => {
    const v = safeInt((x as any).elevationGainM);
    return v === undefined ? undefined : clamp(v, 0, 20000);
  })();

  const routePolyline = safePolyline((x as any).routePolyline);

  const kind = typeof (x as any).kind === "string" ? ((x as any).kind as ActivityKind) : undefined;
  const origin = typeof (x as any).origin === "string" ? ((x as any).origin as ActivityOrigin) : undefined;

  const context = sanitizeContext((x as any).context);
  const pain = (x as any).pain == null ? null : sanitizePain((x as any).pain);

  const notes = typeof (x as any).notes === "string" ? (x as any).notes : undefined;

  const sportRaw = (x as any).sport;
  const sport = isSport(sportRaw) ? sportRaw : inferSport({ kind, type });

  return {
    id,
    date,
    sport,
    type,
    title,
    durationMin,
    distanceKm,
    rpe,
    avgHr,
    elevationGainM,
    routePolyline,
    kind,
    origin,
    context,
    pain,
    notes,
    createdAt,
    updatedAt,
  };
}

function migrateV2ItemToV3(x: unknown): Activity | null {
  // V2 ressemblait déjà à V3 mais sans `sport`
  const v2 = sanitizeV3Item({ ...(isObj(x) ? x : {}), sport: undefined });
  return v2;
}

function migrateV1ItemToV3(x: unknown): Activity | null {
  if (!isObj(x)) return null;

  const id = normStr((x as any).id);
  const date = normalizeDate((x as any).date);
  const type = isActivityType((x as any).type) ? ((x as any).type as ActivityType) : null;
  if (!id || !date || !type) return null;

  const now = Date.now();

  const title = (() => {
    const t = normStr((x as any).title);
    return t ? t : inferTitle(type);
  })();

  const durationMin = (() => {
    const v = safeInt((x as any).durationMin);
    return v === undefined ? undefined : clamp(v, 0, 24 * 60);
  })();

  const distanceKm = (() => {
    const v = safeNum((x as any).distanceKm);
    return v === undefined ? undefined : clamp(v, 0, 1000);
  })();

  const rpe = (() => {
    const v = safeInt((x as any).rpe);
    return v === undefined ? undefined : clamp(v, 1, 10);
  })();

  const avgHr = (() => {
    const v = safeInt((x as any).avgHr);
    return v === undefined ? undefined : clamp(v, 30, 240);
  })();

  const createdAt = safeInt((x as any).createdAt) ?? now;
  const updatedAt = safeInt((x as any).updatedAt) ?? createdAt;
  const notes = typeof (x as any).notes === "string" ? (x as any).notes : undefined;

  // V1 ne connaissait pas sport -> infère
  const kind: ActivityKind | undefined =
    type === "rest" || type === "cross" ? "other" : "run";

  const sport = inferSport({ kind, type });

  return {
    id,
    date,
    sport,
    type,
    title,
    durationMin,
    distanceKm,
    rpe,
    avgHr,
    notes,
    createdAt,
    updatedAt,
    kind,
    origin: "free",
    context: undefined,
    pain: null,
    elevationGainM: undefined,
    routePolyline: undefined,
  };
}

/* ------------------------------ Migration logique --------------------------- */

async function ensureMigrated(): Promise<void> {
  await withGate(async () => {
    if (await hasValidArray(KEY_V3)) return;

    // 1) migrate from V2 if exists
    const v2 = await readJson(KEY_V2);
    if (Array.isArray(v2)) {
      const migrated: Activity[] = [];
      for (const it of v2) {
        const m = migrateV2ItemToV3(it);
        if (m) migrated.push(m);
      }
      migrated.sort(sortByDateDesc);
      await writeV3(migrated);
      return;
    }

    // 2) migrate from V1
    const v1 = await readJson(KEY_V1);
    if (!Array.isArray(v1)) {
      await writeV3([]);
      return;
    }

    const migrated: Activity[] = [];
    for (const it of v1) {
      const m = migrateV1ItemToV3(it);
      if (m) migrated.push(m);
    }

    migrated.sort(sortByDateDesc);
    await writeV3(migrated);
  });
}

async function readAllSanitized(): Promise<Activity[]> {
  await ensureMigrated();

  const parsed = await readJson(KEY_V3);
  if (!Array.isArray(parsed)) {
    await writeV3([]);
    return [];
  }

  const out: Activity[] = [];
  let dirty = false;

  for (const it of parsed) {
    const s = sanitizeV3Item(it);
    if (s) out.push(s);
    else dirty = true;
  }

  out.sort(sortByDateDesc);
  if (dirty) await writeV3(out);

  return out;
}

/* --------------------------------- Public API ------------------------------ */

export async function listActivities(): Promise<Activity[]> {
  return await readAllSanitized();
}

export async function getActivity(id: string): Promise<Activity | null> {
  const list = await readAllSanitized();
  return list.find((a) => a.id === id) ?? null;
}

export async function upsertActivity(input: UpsertActivityInput): Promise<Activity> {
  return await withGate(async () => {
    const now = Date.now();
    const list = await readAllSanitized();

    const id = normStr(input.id);
    if (!id) throw new Error("Invalid id.");

    const date = normalizeDate(input.date);
    if (!date) throw new Error("Invalid date (expected YYYY-MM-DD).");

    if (!isActivityType(input.type)) throw new Error("Invalid activity type.");

    const title = (() => {
      const t = normStr(input.title);
      return t ? t : inferTitle(input.type);
    })();

    const durationMin =
      input.durationMin === undefined ? undefined : clamp(Math.round(input.durationMin), 0, 24 * 60);
    const distanceKm =
      input.distanceKm === undefined ? undefined : clamp(input.distanceKm, 0, 1000);
    const rpe =
      input.rpe === undefined ? undefined : clamp(Math.round(input.rpe), 1, 10);
    const avgHr =
      input.avgHr === undefined ? undefined : clamp(Math.round(input.avgHr), 30, 240);
    const elevationGainM =
      input.elevationGainM === undefined ? undefined : clamp(Math.round(input.elevationGainM), 0, 20000);

    const routePolyline = safePolyline(input.routePolyline);

    const pain = input.pain == null ? null : sanitizePain(input.pain);
    const context = sanitizeContext(input.context);
    const notes = typeof input.notes === "string" ? input.notes : undefined;

    const idx = list.findIndex((a) => a.id === id);

    if (idx >= 0) {
      const prev = list[idx];

      const kind = input.kind ?? prev.kind;
      const sport = inferSport({ sport: input.sport, kind, type: input.type });

      const updated: Activity = {
        ...prev,
        id,
        date,
        sport,
        type: input.type,
        title,
        durationMin,
        distanceKm,
        rpe,
        avgHr,
        elevationGainM,
        routePolyline,
        kind,
        origin: input.origin ?? prev.origin ?? "free",
        context,
        pain,
        notes,
        createdAt: prev.createdAt ?? input.createdAt ?? now,
        updatedAt: input.updatedAt ?? now,
      };

      list[idx] = updated;
      list.sort(sortByDateDesc);
      await writeV3(list);
      return updated;
    }

    const kind = input.kind;
    const sport = inferSport({ sport: input.sport, kind, type: input.type });

    const created: Activity = {
      id,
      date,
      sport,
      type: input.type,
      title,
      durationMin,
      distanceKm,
      rpe,
      avgHr,
      elevationGainM,
      routePolyline,
      kind,
      origin: input.origin ?? "free",
      context,
      pain,
      notes,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };

    list.push(created);
    list.sort(sortByDateDesc);
    await writeV3(list);
    return created;
  });
}

export async function deleteActivity(id: string): Promise<void> {
  await withGate(async () => {
    const list = await readAllSanitized();
    await writeV3(list.filter((a) => a.id !== id));
  });
}

export async function clearActivities(): Promise<void> {
  await withGate(async () => {
    await AsyncStorage.removeItem(KEY_V3);
    await AsyncStorage.removeItem(KEY_V2);
    await AsyncStorage.removeItem(KEY_V1);
  });
}

export async function listActivitiesInRange(fromISO: string, toISO: string): Promise<Activity[]> {
  const from = normalizeDate(fromISO);
  const to = normalizeDate(toISO);
  if (!from || !to) return [];

  const a = from <= to ? { from, to } : { from: to, to: from };

  const list = await readAllSanitized();
  return list.filter((x) => x.date >= a.from && x.date <= a.to);
}

/** utile si d’autres modules veulent connaître la clé */
export const ACTIVITIES_STORAGE_KEY = KEY_V3;
