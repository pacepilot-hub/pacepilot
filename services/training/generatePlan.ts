// services/training/generatePlan.ts
import type { TrainingPlan } from "@/storage/trainingPlan";
import type { Profile, Program } from "@/storage/onboarding";

/* ---------------------------------- utils --------------------------------- */

type SessionsPerWeek = 2 | 3 | 4 | 5 | 6;
type Focus = "Base" | "Spécifique" | "Taper";
type Intensity = "EASY" | "THRESHOLD" | "LONG";

const DOW_MIN = 0; // Lun=0..Dim=6 (comme ton code)
const DOW_MAX = 6;

function isoNow(): string {
  return new Date().toISOString();
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const x = isFiniteNumber(n) ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  const v = Math.trunc(x);
  return Math.max(min, Math.min(max, v));
}

function normalizeText(v: unknown, fallback: string) {
  const s = String(v ?? "").trim();
  return s.length ? s : fallback;
}

function includesAny(hay: string, needles: string[]) {
  const h = hay.toLowerCase();
  return needles.some((n) => h.includes(n));
}

/** Uniques + triés (0..6), taille maxCount */
function uniqSortedDays(input: unknown, maxCount: number): number[] {
  const arr = Array.isArray(input) ? input : [];
  const clean = arr
    .map((d) => clampInt(d, DOW_MIN, DOW_MAX, -1))
    .filter((d) => d >= DOW_MIN && d <= DOW_MAX);

  const uniq = Array.from(new Set(clean)).sort((a, b) => a - b);
  return uniq.slice(0, Math.max(0, maxCount));
}

function pickSessionsPerWeek(v: unknown): SessionsPerWeek {
  const n = clampInt(v, 2, 6, 3);
  return (n === 2 || n === 3 || n === 4 || n === 5 || n === 6 ? n : 3) as SessionsPerWeek;
}

/**
 * Répartit un total en parts entières, somme garantie = total
 * Ex: splitInt(10,[1,1,2]) -> [2,2,6] (proportionnel)
 */
function splitInt(total: number, weights: number[]): number[] {
  const T = Math.max(0, Math.trunc(total));
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sumW = w.reduce((a, b) => a + b, 0);

  if (T === 0) return weights.map(() => 0);
  if (sumW === 0) return weights.map(() => 0);

  const raw = w.map((x) => (T * x) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let rest = T - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);

  const out = [...floors];
  let k = 0;
  while (rest > 0 && order.length) {
    out[order[k].i] += 1;
    rest -= 1;
    k = (k + 1) % order.length;
  }
  return out;
}

/* ------------------------------ goal heuristics ---------------------------- */

type GoalKind = "marathon" | "half" | "tenK" | "fiveK" | "trail" | "restart" | "fitness";

function detectGoalKind(goal: string): GoalKind {
  const g = goal.toLowerCase();

  if (includesAny(g, ["marathon"])) return "marathon";
  if (includesAny(g, ["semi", "half"])) return "half";
  if (includesAny(g, ["trail", "ultra", "d+", "dplus"])) return "trail";
  if (includesAny(g, ["reprise", "retour", "restart"])) return "restart";
  if (includesAny(g, ["forme", "santé", "sante", "perte", "weight"])) return "fitness";

  // évite le piège "10" dans "210"
  if (includesAny(g, ["10 km", "10km", "10k"])) return "tenK";
  if (includesAny(g, ["5 km", "5km", "5k"])) return "fiveK";

  return "fitness";
}

function weeksForGoal(kind: GoalKind): number {
  switch (kind) {
    case "marathon":
      return 12;
    case "half":
    case "trail":
      return 10;
    case "tenK":
      return 8;
    case "fiveK":
    case "restart":
    case "fitness":
    default:
      return 6;
  }
}

type LevelKind = "beginner" | "intermediate" | "advanced";

function detectLevelKind(level: string): LevelKind {
  const l = level.toLowerCase();
  if (includesAny(l, ["début", "debut", "begin"])) return "beginner";
  if (includesAny(l, ["avanc", "advanc", "confirm"])) return "advanced";
  return "intermediate";
}

function baseKmForLevel(kind: LevelKind): number {
  switch (kind) {
    case "beginner":
      return 18;
    case "advanced":
      return 40;
    case "intermediate":
    default:
      return 28;
  }
}

/* ------------------------------ plan logic -------------------------------- */

function focusForWeek(weekIndex: number, weeksCount: number): Focus {
  if (weekIndex <= 4) return "Base";
  if (weekIndex <= weeksCount - 2) return "Spécifique";
  return "Taper";
}

function growthPerWeek(kind: GoalKind): number {
  // plus doux pour reprise/fitness
  if (kind === "restart" || kind === "fitness") return 0.03;
  return 0.05;
}

function deloadFactor(weekIndex: number): number {
  // toutes les 4 semaines
  return weekIndex % 4 === 0 ? 0.85 : 1.0;
}

/**
 * Split hebdo en (easy/quality/long) en km entiers, somme = weekKm
 * - si 2 séances : pas de qualité dédiée
 * - si restart : qualité souvent off (sauf si tu veux la réactiver plus tard)
 */
function splitWeekKm(weekKm: number, sessionsCount: number, goalKind: GoalKind) {
  const km = Math.max(0, Math.trunc(weekKm));

  // 1 séance : tout en longue (réaliste en MVP)
  if (sessionsCount <= 1) {
    return { easyKm: 0, qualityKm: 0, longKm: km };
  }

  // 2 séances : easy + long (pas de qualité)
  if (sessionsCount === 2 || goalKind === "restart") {
    const [easy, long] = splitInt(km, [0.6, 0.4]);
    return { easyKm: easy, qualityKm: 0, longKm: long };
  }

  // >=3 séances : 50/25/25
  const [easy, quality, long] = splitInt(km, [0.5, 0.25, 0.25]);
  return { easyKm: easy, qualityKm: quality, longKm: long };
}

function makeSessionLabel(goalKind: GoalKind, intensity: Intensity) {
  if (intensity === "LONG") return goalKind === "trail" ? "Sortie longue (côtes)" : "Sortie longue";
  if (intensity === "THRESHOLD") return goalKind === "trail" ? "Côtes / force" : "Séance seuil";
  return goalKind === "restart" ? "Footing (reprise)" : "Footing";
}

function makeSessionNotes(goalKind: GoalKind, intensity: Intensity) {
  if (intensity === "LONG") return "Allure facile, focus régularité.";
  if (intensity === "THRESHOLD") {
    return goalKind === "trail"
      ? "Ex: 10×45s côte (récup descente)."
      : "Ex: 3×8' seuil (récup 3').";
  }
  return "Très souple, respiration facile.";
}

/**
 * Choix “stable” des slots :
 * - Long = dernier jour choisi
 * - Qualité = 2e jour choisi (index 1) si autorisé
 */
function pickLongSlot(daysCount: number) {
  return Math.max(0, daysCount - 1);
}

function pickQualitySlot(daysCount: number, goalKind: GoalKind) {
  const can = daysCount >= 3 && goalKind !== "restart";
  return can ? 1 : -1;
}

/**
 * Jours par défaut (0..6 Lun..Dim)
 * Objectif : espacer + SL en fin de semaine
 */
function defaultTrainingDays(spw: SessionsPerWeek): number[] {
  const defaults: Record<SessionsPerWeek, number[]> = {
    2: [1, 5], // Mar / Sam
    3: [1, 3, 6], // Mar / Jeu / Dim
    4: [1, 3, 5, 6], // Mar / Jeu / Sam / Dim
    5: [0, 1, 3, 5, 6], // Lun / Mar / Jeu / Sam / Dim
    6: [0, 1, 2, 3, 5, 6], // Lun..Jeu + Sam + Dim
  };
  return defaults[spw];
}

function buildTrainingDays(spw: SessionsPerWeek, userDays?: unknown): number[] {
  const wanted = uniqSortedDays(userDays, spw);
  const defaults = defaultTrainingDays(spw);

  const out: number[] = [];

  // 1) user
  for (const d of wanted) {
    if (out.length >= spw) break;
    if (!out.includes(d)) out.push(d);
  }

  // 2) defaults
  for (const d of defaults) {
    if (out.length >= spw) break;
    if (!out.includes(d)) out.push(d);
  }

  // 3) fallback: remplir avec le reste de la semaine
  for (let d = 0; d <= 6 && out.length < spw; d++) {
    if (!out.includes(d)) out.push(d);
  }

  return out.slice(0, spw);
}

/* -------------------------------- generator -------------------------------- */

export function generatePlan(profile: Profile, program: Program): TrainingPlan {
  // futur: VMA, contraintes, blessures, etc.
  void profile;

  const goalText = normalizeText((program as any)?.goal, "10 km");
  const levelText = normalizeText((program as any)?.level, "Intermédiaire");

  const sessionsPerWeek = pickSessionsPerWeek((program as any)?.sessionsPerWeek);
  const trainingDays = buildTrainingDays(sessionsPerWeek, (program as any)?.trainingDays);

  const goalKind = detectGoalKind(goalText);
  const levelKind = detectLevelKind(levelText);

  const weeksCount = weeksForGoal(goalKind);
  const baseKm = baseKmForLevel(levelKind);

  return {
    planId: `plan_${Date.now()}`,
    goal: goalText,
    level: levelText,
    createdAt: isoNow(),
    version: 3,
    weeks: Array.from({ length: weeksCount }, (_, wi) => {
      const weekIndex = wi + 1;

      const gentle = growthPerWeek(goalKind);
      const factor = (1 + (weekIndex - 1) * gentle) * deloadFactor(weekIndex);

      // bornes “sûres”
      const weekKm = Math.max(10, Math.round(baseKm * factor));

      const focus = focusForWeek(weekIndex, weeksCount);

      const longIndex = pickLongSlot(trainingDays.length);
      const qualityIndex = pickQualitySlot(trainingDays.length, goalKind);

      const { easyKm, qualityKm, longKm } = splitWeekKm(weekKm, trainingDays.length, goalKind);

      // slots easy = tout sauf long & quality
      const easySlots = trainingDays
        .map((_, idx) => idx)
        .filter((idx) => idx !== longIndex && idx !== qualityIndex);

      const easyParts = easySlots.length ? splitInt(easyKm, easySlots.map(() => 1)) : [];
      let easyCursor = 0;

      const sessions = trainingDays.map((dayOfWeek, idx) => {
        let intensity: Intensity = "EASY";
        let distanceKm = 0;

        if (idx === longIndex) {
          intensity = "LONG";
          distanceKm = longKm;
        } else if (idx === qualityIndex) {
          intensity = "THRESHOLD";
          distanceKm = qualityKm;
        } else {
          distanceKm = easyParts[easyCursor] ?? 0;
          easyCursor += 1;
        }

        // garde-fou : si un slot tombe à 0 (peu probable), on met 1 km mini
        // sans casser la somme: on ne “crée” PAS de km ici -> on accepte 0 si besoin
        // (si tu veux un min absolu, il faut compenser ailleurs explicitement)
        const safeKm = Math.max(0, Math.trunc(distanceKm));

        return {
          dayOfWeek,
          label: makeSessionLabel(goalKind, intensity),
          intensity,
          distanceKm: safeKm,
          notes: makeSessionNotes(goalKind, intensity),
        } as const;
      });

      // ✅ vérif sceptique: somme des sessions == totalKm (sinon on corrige doucement)
      const sum = sessions.reduce((s, x) => s + (Number.isFinite(x.distanceKm) ? x.distanceKm : 0), 0);
      let fixedSessions = sessions;

      if (sum !== weekKm && sessions.length) {
        // on corrige le delta sur la sortie longue (le plus logique en MVP)
        const delta = weekKm - sum;
        fixedSessions = sessions.map((s, i) =>
          i === longIndex
            ? { ...s, distanceKm: Math.max(0, Math.trunc((s.distanceKm ?? 0) + delta)) }
            : s
        ) as any;
      }

      return {
        weekIndex,
        focus,
        totalKm: weekKm,
        sessions: fixedSessions,
      };
    }),
  };
}
