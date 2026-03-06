import type { Activity as StoredActivity } from "@/storage/activities";
import type { ActivityUI, SportType } from "@/storage/types";

/* -------------------------------- helpers -------------------------------- */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Parsing "YYYY-MM-DD" sans bug timezone :
 * new Date("2026-01-28") = UTC -> peut décaler en local.
 * Donc on parse manuellement.
 */
function parseYYYYMMDD(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  // midi local = évite DST bizarres
  const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function safeIsoToDate(iso: string): Date | null {
  const s = safeStr(iso);
  if (!s) return null;

  const local = parseYYYYMMDD(s);
  if (local) return local;

  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDateFR(iso: string): string {
  const d = safeIsoToDate(iso);
  if (!d) return iso;

  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(d);
}

/**
 * ⚠️ mapSport DOIT renvoyer une valeur réelle de SportType
 * On évite absolument les casts "as SportType" de valeurs inconnues.
 *
 * Priorité:
 * 1) a.sport (canonical V3 si présent)
 * 2) a.kind (legacy)
 * 3) a.type (legacy)
 */
function mapSport(a: StoredActivity): SportType {
  const sport = safeStr((a as any).sport); // canonical (si tu l’ajoutes)
  switch (sport) {
    case "run":
    case "trail":
      return "Course";
    case "bike_road":
    case "bike_mtb":
      return "Vélo";
    case "hike":
    case "walk":
      return "Marche";
    case "strength":
    case "swim":
    case "other":
      return "Renfo"; // UI MVP (si "Natation" pas supportée dans SportType)
    default:
      break;
  }

  const kind = safeStr((a as any).kind);
  if (kind === "bike") return "Vélo";
  if (kind === "hike" || kind === "walk") return "Marche";
  if (kind === "trail_run" || kind === "run") return "Course";

  switch (a.type) {
    case "cross":
      return "Vélo";
    case "rest":
      return "Renfo"; // repos n’est pas un “sport” -> UI stable
    default:
      return "Course";
  }
}

function toDurationSec(durationMin: StoredActivity["durationMin"]): number | undefined {
  if (!isFiniteNumber(durationMin) || durationMin <= 0) return undefined;

  const safeMin = Math.max(0, Math.min(24 * 60, durationMin));
  return Math.round(safeMin * 60);
}

function normalizeIntensityFromTitle(title: string): ActivityUI["intensity"] {
  const t = safeStr(title).toLowerCase();
  if (!t) return undefined;

  if (t.includes("race") || t.includes("course")) return "race";
  if (t.includes("fraction") || t.includes("interv")) return "interval";
  if (t.includes("seuil") || t.includes("tempo")) return "threshold";
  if (t.includes("long")) return "steady";
  if (t.includes("ef") || t.includes("footing") || t.includes("easy")) return "easy";

  return undefined;
}

function mapIntensity(a: StoredActivity): ActivityUI["intensity"] {
  switch (a.type) {
    case "easy":
      return "easy";
    case "tempo":
      return "threshold";
    case "intervals":
      return "interval";
    case "race":
      return "race";
    case "long":
      return "steady";
    default:
      return normalizeIntensityFromTitle(a.title);
  }
}

/* --------------------------------- main ---------------------------------- */

export function toActivityUI(a: StoredActivity): ActivityUI {
  const title = safeStr(a.title) || "Séance";

  const distanceKm =
    isFiniteNumber(a.distanceKm) && a.distanceKm > 0
      ? Math.max(0, Math.min(1000, a.distanceKm))
      : undefined;

  return {
    id: a.id,
    sport: mapSport(a),
    title,
    dateLabel: formatDateFR(a.date),
    distanceKm,
    durationSec: toDurationSec(a.durationMin),
    rpe: isFiniteNumber(a.rpe) ? Math.max(1, Math.min(10, Math.round(a.rpe))) : undefined,
    intensity: mapIntensity(a),
  };
}
