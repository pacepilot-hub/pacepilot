// storage/activityItemMapper.ts
import type { Activity as StoredActivity } from "@/storage/activities";
import type { ActivityItem } from "@/components/ActivityRow";

/* --------------------------------- helpers -------------------------------- */

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function toInt(n: number) {
  return Math.round(n);
}

function safeText(s?: string | null): string | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  return t.length ? t : undefined;
}

/**
 * Date label:
 * - si YYYY-MM-DD valide -> "DD/MM"
 * - sinon renvoie string brute
 */
function formatDateLabelFR(iso: string): string {
  if (typeof iso !== "string") return String(iso);

  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;

  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (!Number.isFinite(mm) || !Number.isFinite(dd)) return iso;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return iso;

  return `${pad2(dd)}/${pad2(mm)}`;
}

function formatDuration(min?: number | null): string {
  if (!isFiniteNumber(min) || min <= 0) return "—";
  const total = toInt(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h${pad2(m)}` : `${m} min`;
}

function formatDistance(km?: number | null): string {
  if (!isFiniteNumber(km) || km <= 0) return "— km";
  const decimals = km < 10 ? 1 : 0;
  return `${km.toFixed(decimals)} km`;
}

function formatPace(min?: number | null, km?: number | null): string | undefined {
  if (!isFiniteNumber(min) || !isFiniteNumber(km) || min <= 0 || km <= 0) return undefined;

  const secPerKm = (min * 60) / km;
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return undefined;

  const mm = Math.floor(secPerKm / 60);
  const ss0 = Math.round(secPerKm - mm * 60);

  // cas ss==60 après arrondi
  const mm2 = ss0 >= 60 ? mm + 1 : mm;
  const ss2 = ss0 >= 60 ? 0 : ss0;

  return `${mm2}:${pad2(ss2)}/km`;
}

/* ------------------------------ mapping rules ------------------------------ */

/**
 * ⚠️ Bêta: on mappe vers les valeurs réellement supportées par ActivityRow.
 * Hypothèse probable: "Course" | "Vélo" | "Renfo" | "Marche"
 *
 * - `sport` (V3) a priorité
 * - sinon fallback sur `kind` (legacy)
 * - sinon fallback sur `type` (tag UI legacy)
 */
function mapSport(a: StoredActivity): ActivityItem["sport"] {
  const sport = (a as any).sport as string | undefined;

  // 1) Canonical V3
  switch (sport) {
    case "bike_road":
    case "bike_mtb":
      return "Vélo";
    case "hike":
    case "walk":
      return "Marche";
    case "swim":
      // si ActivityRow ne supporte pas "Natation" pour l’instant:
      // on fallback sur "Renfo" ou "Course" (choix UI)
      return "Renfo";
    case "strength":
      return "Renfo";
    case "trail":
    case "run":
      return "Course";
    case "other":
      return "Renfo";
    default:
      break;
  }

  // 2) Legacy kind
  switch (a.kind) {
    case "bike":
      return "Vélo";
    case "hike":
    case "walk":
      return "Marche";
    case "trail_run":
    case "run":
      return "Course";
    default:
      break;
  }

  // 3) Legacy type
  switch (a.type) {
    case "cross":
      return "Vélo";
    case "rest":
      return "Renfo";
    default:
      return "Course";
  }
}

function mapWeather(a: StoredActivity): ActivityItem["weather"] {
  // MVP: si tu stockes context.weather, on l’utilise
  const w = a.context?.weather;

  if (w === "hot") return { temp: 0, icon: "sunny" };
  if (w === "cold") return { temp: 0, icon: "cloud" };
  if (w === "wind") return { temp: 0, icon: "partly" };
  if (w === "rain") return { temp: 0, icon: "rain" };

  // Fallback heuristique par type
  switch (a.type) {
    case "intervals":
      return { temp: 0, icon: "storm" };
    case "tempo":
      return { temp: 0, icon: "partly" };
    case "long":
      return { temp: 0, icon: "rain" };
    default:
      return { temp: 0, icon: "cloud" };
  }
}

/**
 * Location (ActivityRow exige un string)
 * - priorité: notes si court, sinon "—"
 */
function mapLocation(a: StoredActivity): string {
  const n = safeText(a.notes);
  if (!n) return "—";
  if (n.length > 60) return "—";
  return n;
}

/* ---------------------------------- main ---------------------------------- */

export function toActivityItem(a: StoredActivity): ActivityItem {
  const title = safeText(a.title) ?? "Séance";
  const duration = formatDuration(a.durationMin);
  const distance = formatDistance(a.distanceKm);
  const pace = formatPace(a.durationMin, a.distanceKm);

  return {
    id: a.id,
    sport: mapSport(a),
    title,
    dateLabel: formatDateLabelFR(a.date),

    location: mapLocation(a),

    distance,
    duration,

    pace,
    calories: undefined,

    weather: mapWeather(a),

    route: undefined,
  };
}
