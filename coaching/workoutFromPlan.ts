// coaching/workoutFromPlan.ts
import type { WorkoutSpec } from "@/coaching/routeGeneratorORS";

/**
 * Type minimal stable pour éviter circular deps.
 */
export type PlanSessionLike = {
  title?: string | null;
  duration?: string | null; // ex "1h20", "45 min", "3 × 8 min", "8×400 m", "1:10", "80'"
  details?: string | null;
  dateISO?: string | null; // "YYYY-MM-DD" idéalement
};

/* -------------------------------- helpers -------------------------------- */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function norm(s: unknown) {
  return String(s ?? "").trim().toLowerCase();
}

function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

/** Hash string simple (stable, sans crypto) */
function hash32(input: string): string {
  let h = 2166136261; // FNV-ish
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function buildWorkoutKey(p: { dateISO?: string | null; type: string; duration?: string | null; title?: string | null }) {
  const date = isISODate(p.dateISO) ? p.dateISO.trim() : "nodate";
  const base = `${date}|${p.type}|${String(p.duration ?? "").trim()}|${String(p.title ?? "").trim()}`;
  return `wk_${date}_${hash32(base)}`;
}

/* ------------------------- duration parsing (robuste) ------------------------- */

/**
 * Convertit une durée texte en minutes.
 * Retourne undefined si non déterminable.
 *
 * Supporte :
 * - "1h", "1 h", "1h05", "1 h 05", "1h20", "1h20min"
 * - "45min", "45 min", "45m"
 * - "80'", "80’"
 * - "1:20" (h:mm) ou "0:45"
 * - formats séance : "3×8min", "8x400m", "10×45s", etc. => estimation prudente
 */
export function parseDurationToMin(duration?: string | null): number | undefined {
  const raw = String(duration ?? "").trim();
  if (!raw) return undefined;

  // Normalisation: minuscules, espaces supprimés, apostrophes unifiées, "×" harmonisé
  const s = raw
    .toLowerCase()
    .replace(/,/g, ".")
    .replace(/[’']/g, "'")
    .replace(/[×]/g, "x")
    .replace(/\s+/g, "");

  // "1:20" => h:mm
  const hhmm = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (hhmm) {
    const h = Number.parseInt(hhmm[1], 10);
    const m = Number.parseInt(hhmm[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m >= 60) return undefined;
    return h * 60 + m;
  }

  // "80'" => minutes
  const apost = s.match(/^(\d+)'$/);
  if (apost) {
    const m = Number.parseInt(apost[1], 10);
    return Number.isFinite(m) ? m : undefined;
  }

  // "1h" / "1h05" / "2h10"
  const hm = s.match(/^(\d+)h(\d{1,2})?$/);
  if (hm) {
    const h = Number.parseInt(hm[1], 10);
    const m = hm[2] ? Number.parseInt(hm[2], 10) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m) || m >= 60) return undefined;
    return h * 60 + m;
  }

  // "1h20min" / "1h20m"
  const hm2 = s.match(/^(\d+)h(\d{1,2})(min|m)$/);
  if (hm2) {
    const h = Number.parseInt(hm2[1], 10);
    const m = Number.parseInt(hm2[2], 10);
    if (!Number.isFinite(h) || !Number.isFinite(m) || m >= 60) return undefined;
    return h * 60 + m;
  }

  // "45min" / "45m"
  const mm = s.match(/^(\d+)(min|m)$/);
  if (mm) {
    const m = Number.parseInt(mm[1], 10);
    return Number.isFinite(m) ? m : undefined;
  }

  // "3x8min" / "3x8m"
  const repMin = s.match(/^(\d+)x(\d+)(min|m)$/);
  if (repMin) {
    const reps = Number.parseInt(repMin[1], 10);
    const each = Number.parseInt(repMin[2], 10);
    if (!Number.isFinite(reps) || !Number.isFinite(each) || reps <= 0 || each <= 0) return undefined;

    // Estimation prudente: warm + blocs + récup + cool
    const main = reps * each;
    const warm = 15;
    const cool = 10;
    const rec = Math.round(Math.max(0, reps - 1) * 2); // ~2' entre blocs
    return warm + main + rec + cool;
  }

  // "8x400m"
  const rep400 = s.match(/^(\d+)x400m$/);
  if (rep400) {
    const reps = Number.parseInt(rep400[1], 10);
    if (!Number.isFinite(reps) || reps <= 0) return undefined;

    // Prudence: 15' warm + (2' effort + 1' récup)*reps + 10' cool
    return clamp(Math.round(15 + reps * 3 + 10), 20, 180);
  }

  // "10x45s" / "10x30sec"
  const repSec = s.match(/^(\d+)x(\d+)(s|sec)$/);
  if (repSec) {
    const reps = Number.parseInt(repSec[1], 10);
    const sec = Number.parseInt(repSec[2], 10);
    if (!Number.isFinite(reps) || !Number.isFinite(sec) || reps <= 0 || sec <= 0) return undefined;

    // effort + récup ~ même durée
    const perRepMin = (sec * 2) / 60;
    return clamp(Math.round(15 + reps * perRepMin + 10), 20, 180);
  }

  // Dernier filet: si on a juste un nombre "75" on l'interprète comme minutes
  const plain = s.match(/^(\d{2,3})$/);
  if (plain) {
    const m = Number.parseInt(plain[1], 10);
    if (!Number.isFinite(m)) return undefined;
    return clamp(m, 10, 300);
  }

  return undefined;
}

/* ------------------------- title -> workout type -------------------------- */

/**
 * Mapping titre -> type ORS (simple et robuste).
 * NOTE: si ton WorkoutSpec["type"] n'a pas d'intervals, on mappe fractionné sur "seuil".
 */
export function workoutTypeFromTitle(title: string): WorkoutSpec["type"] {
  const t = norm(title);

  if (!t) return "ef";

  // repos (routing pas utile, mais on renvoie un type safe)
  if (t.includes("repos") || t.includes("rest")) return "ef";

  // trail / rando
  if (t.includes("trail")) return "trail";

  // côtes
  if (t.includes("côte") || t.includes("cote") || t.includes("côtes") || t.includes("cotes")) return "cotes";

  // sortie longue
  if (t.includes("sortie longue") || /\bsl\b/.test(t) || t.includes("long")) return "sl";

  // seuil / tempo
  if (t.includes("seuil") || t.includes("tempo") || t.includes("threshold")) return "seuil";

  // intervalles / fractionné / vma => seuil (ORS routing: on ne veut pas surcontraindre)
  if (t.includes("interv") || t.includes("fraction") || t.includes("vma")) return "seuil";

  return "ef";
}

/* -------------------- infer targets (distance / d+) -------------------- */

function defaultPaceMinPerKm(type: WorkoutSpec["type"]) {
  // valeurs "routing" (pas physiologie) -> juste pour estimer une distance plausible
  if (type === "seuil") return 5.0;
  if (type === "sl") return 5.9;
  if (type === "cotes") return 6.6;
  if (type === "trail") return 7.0;
  return 6.0; // ef
}

/**
 * On évite de figer une distance cible pour :
 * - séances courtes
 * - fractionné court ("8x400m", "10x45s", etc.)
 */
function shouldSetDistanceTarget(durationMin: number, durationRaw?: string | null) {
  const d = clamp(durationMin, 0, 999);
  if (d < 35) return false;

  const s = norm(durationRaw).replace(/\s+/g, "").replace(/[×]/g, "x");
  if (!s) return true;

  // indices de fractionné court
  if (s.includes("x400m")) return false;
  if (/[x]\d+(s|sec)$/.test(s)) return false;

  return true;
}

function inferTargetDistanceKm(type: WorkoutSpec["type"], durationMin: number, durationRaw?: string | null): number | undefined {
  if (!shouldSetDistanceTarget(durationMin, durationRaw)) return undefined;

  const pace = defaultPaceMinPerKm(type);
  const km = durationMin / pace;
  if (!Number.isFinite(km) || km <= 0) return undefined;

  // 0.1 km
  return Math.round(km * 10) / 10;
}

function inferTargetDplus(type: WorkoutSpec["type"], durationMin: number): number | undefined {
  const d = clamp(durationMin, 20, 240);

  // Heuristiques “routing”
  if (type === "trail") return clamp(Math.round(d * 3.2), 150, 900);
  if (type === "cotes") return clamp(Math.round(d * 2.6), 120, 700);
  if (type === "sl") return clamp(Math.round(d * 1.2), 60, 420);
  if (type === "seuil") return clamp(Math.round(d * 0.8), 0, 260);
  return clamp(Math.round(d * 0.9), 0, 280);
}

/* ------------------------------ main API ------------------------------ */

/**
 * Convertit une séance “plan” -> WorkoutSpec (routing ORS)
 */
export function workoutFromSession(session: PlanSessionLike | null | undefined): WorkoutSpec {
  const titleRaw = String(session?.title ?? "").trim();
  const type = workoutTypeFromTitle(titleRaw);

  const parsed = parseDurationToMin(session?.duration);

  // défaut sceptique : 60 min, borné
  const durationMin = clamp(parsed ?? 60, 20, 240);

  const distanceKm = inferTargetDistanceKm(type, durationMin, session?.duration);
  const elevationGainM = inferTargetDplus(type, durationMin);

  const label = titleRaw || "Séance du jour";

  const workoutKey = buildWorkoutKey({
    dateISO: session?.dateISO,
    type,
    duration: session?.duration,
    title: session?.title,
  });

  // assemble sans "falsy trap" (si distanceKm=0.0 on ne veut pas la drop… même si ici on ne met jamais 0)
  const out: any = {
    type,
    durationMin,
    label,
    workoutKey,
  };

  if (typeof distanceKm === "number" && Number.isFinite(distanceKm) && distanceKm > 0) out.distanceKm = distanceKm;
  if (typeof elevationGainM === "number" && Number.isFinite(elevationGainM) && elevationGainM > 0) out.elevationGainM = elevationGainM;

  return out as WorkoutSpec;
}

/**
 * ORS profile
 */
export function profileFromWorkoutType(t: WorkoutSpec["type"]): "foot-walking" | "foot-hiking" {
  return t === "trail" ? "foot-hiking" : "foot-walking";
}
