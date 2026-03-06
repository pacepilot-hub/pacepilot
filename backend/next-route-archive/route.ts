// app/api/route/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LatLng = { lat: number; lng: number };

type Body = {
  coordinates: LatLng[]; // points tapés / waypoints IA
  profile?: "foot-walking" | "foot-hiking"; // running=foot-walking, trail=foot-hiking
  preference?: "recommended" | "fastest" | "shortest";
  geometry_format?: "geojson" | "encodedpolyline";
  language?: string; // ex: "fr"
  units?: "m" | "km";
  instructions?: boolean;
  elevation?: boolean;
  continue_straight?: boolean;
  suppress_warnings?: boolean;

  // garde-fous côté serveur (anti abus / anti crash)
  maxPointsOverride?: number; // debug only (si tu veux tester)
};

type ORSErrorShape = {
  error?: any;
  message?: string;
  code?: number | string;
  details?: any;
};

function asNum(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function isLatLng(p: any): p is LatLng {
  const lat = asNum(p?.lat);
  const lng = asNum(p?.lng);
  if (lat === null || lng === null) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function toLngLat(p: LatLng): [number, number] {
  return [p.lng, p.lat];
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function uniqueConsecutive(points: LatLng[], eps = 1e-6) {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(p);
      continue;
    }
    const dLat = Math.abs(p.lat - last.lat);
    const dLng = Math.abs(p.lng - last.lng);
    if (dLat > eps || dLng > eps) out.push(p);
  }
  return out;
}

function safeJson(data: any) {
  try {
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ ok: false, error: "Serialization error" }, { status: 500 });
  }
}

function err(status: number, msg: string, extra?: any) {
  return NextResponse.json({ ok: false, error: msg, ...(extra ? { details: extra } : {}) }, { status });
}

function sanitizeProfile(p?: Body["profile"]) {
  return p === "foot-hiking" || p === "foot-walking" ? p : "foot-walking";
}

function sanitizePreference(p?: Body["preference"]) {
  return p === "fastest" || p === "shortest" || p === "recommended" ? p : "recommended";
}

function sanitizeGeometry(g?: Body["geometry_format"]) {
  return g === "encodedpolyline" || g === "geojson" ? g : "geojson";
}

function sanitizeLanguage(lang?: string) {
  // ORS accepte des langues (ex: "fr"). On se limite à un petit set safe.
  const v = String(lang ?? "fr").toLowerCase();
  const allowed = new Set(["fr", "en", "de", "es", "it", "pt", "nl"]);
  return allowed.has(v) ? v : "fr";
}

function bool(v: any, def: boolean) {
  if (typeof v === "boolean") return v;
  return def;
}

function withTimeout(ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { ac, clear: () => clearTimeout(t) };
}

export async function POST(req: Request) {
  const ORS_KEY = process.env.ORS_KEY;
  if (!ORS_KEY) return err(500, "Missing ORS_KEY");

  // Content-Type guard (utile pour éviter des surprises)
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return err(415, "Content-Type must be application/json");
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return err(400, "Invalid JSON body");
  }

  const rawPoints = Array.isArray(body.coordinates) ? body.coordinates : [];
  if (rawPoints.length < 2) return err(400, "Need at least 2 coordinates");

  // Validation + normalisation
  const points: LatLng[] = [];
  for (const p of rawPoints) {
    if (!isLatLng(p)) return err(400, "Invalid coordinate(s). Expected lat/lng in valid ranges.");
    points.push({ lat: p.lat, lng: p.lng });
  }

  // Dedup consécutifs : évite erreurs ORS + réduit coût
  const clean = uniqueConsecutive(points);

  if (clean.length < 2) return err(400, "Coordinates collapse to < 2 unique points");

  // Garde-fou: limite le nombre de points (anti abus / anti 413 / anti timeouts)
  const HARD_MAX_POINTS = 60;
  const softMax = clamp(body.maxPointsOverride ?? 40, 2, HARD_MAX_POINTS);

  const limited = clean.slice(0, softMax);
  if (limited.length < clean.length) {
    // on ne fail pas, on tronque proprement
    // (si tu préfères fail: return err(413, `Too many points (max ${softMax})`)
  }

  const profile = sanitizeProfile(body.profile);
  const preference = sanitizePreference(body.preference);
  const geometry = sanitizeGeometry(body.geometry_format);

  // options “IA silencieuse” (prêtes à être branchées depuis le générateur de parcours)
  const language = sanitizeLanguage(body.language);
  const units = body.units === "km" ? "km" : "m";
  const instructions = bool(body.instructions, true);
  const elevation = bool(body.elevation, false);
  const continue_straight = bool(body.continue_straight, false);
  const suppress_warnings = bool(body.suppress_warnings, true);

  const orsCoords = limited.map(toLngLat); // ⚠️ ORS = [lng, lat]

  // Endpoint ORS v2 directions
  const url = `https://api.openrouteservice.org/v2/directions/${profile}/${geometry}`;

  const payload = {
    coordinates: orsCoords,
    preference,
    language,
    units,
    instructions,
    elevation,
    continue_straight,
    suppress_warnings,
    // options: { avoid_features: ["highways"] } // prêt à activer plus tard
  };

  // Timeout + erreurs propres (pas d’erreurs cryptiques côté app)
  const { ac, clear } = withTimeout(12_000);

  let r: Response;
  let data: any;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: ORS_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
  } catch (e: any) {
    clear();
    const aborted = String(e?.name ?? "").toLowerCase().includes("abort");
    return err(504, aborted ? "ORS request timeout" : "Network error while calling ORS", {
      hint: "Check ORS_KEY, connectivity, and rate limits.",
    });
  } finally {
    clear();
  }

  // ORS renvoie souvent du JSON, mais on sécurise
  const text = await r.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    const details: ORSErrorShape = data ?? {};
    // Normalisation d’erreur + renvoi du status ORS
    return err(r.status, "ORS error", {
      status: r.status,
      message: details?.message ?? details?.error ?? "Unknown ORS error",
      details,
    });
  }

  // Patch: réponse “safe” (si tu veux alléger: tu peux extraire geometry + summary)
  return safeJson({ ok: true, ...data });
}
