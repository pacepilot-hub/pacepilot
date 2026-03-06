// coaching/planGenerator.ts
import type { WeeklyPlan, WeeklyPlanDay, WeeklyPlanDays } from "@/storage/weeklyPlan";
import type { Goal, Level, SessionsPerWeek } from "@/storage/onboarding";
import { addDaysISO, formatWeekLabelFR, getMondayISO } from "@/coaching/dates";

/**
 * Générateur hebdo (MVP) — refactor robuste
 *
 * Invariants:
 * - days = tuple 7 jours (WeeklyPlanDays)
 * - dowIndex 0..6 (Lun..Dim)
 * - date = weekStartDate + dow (ISO local)
 * - workout = WeeklyPlanDay["workout"] (source unique)
 */

export type WorkoutType = WeeklyPlanDay["workout"];
type DowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function nowMs() {
  return Date.now();
}

function uid(prefix = "plan") {
  // stable-ish, assez unique pour AsyncStorage
  return `${prefix}_${nowMs().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normText(v: unknown): string {
  const s = String(v ?? "").trim();
  return stripAccents(s).toLowerCase();
}

/* -------------------------------- sessions/week --------------------------- */

function clampSessionsPerWeek(v: SessionsPerWeek | number): SessionsPerWeek {
  const raw = typeof v === "number" ? v : (v as unknown as number);
  const i = clampInt(isFiniteNumber(raw) ? raw : 3, 2, 6);
  return i as SessionsPerWeek; // 2..6
}

/**
 * Pattern logique par nb de séances (dans l'ordre "dans la semaine")
 * NB: dernière séance = Sortie longue
 */
function workoutPattern(sessionsPerWeek: SessionsPerWeek): readonly WorkoutType[] {
  const patterns: Record<number, readonly WorkoutType[]> = {
    2: ["EF", "Sortie longue"],
    3: ["Fractionné", "EF", "Sortie longue"],
    4: ["Fractionné", "EF", "Seuil", "Sortie longue"],
    5: ["Fractionné", "EF", "Seuil", "EF", "Sortie longue"],
    6: ["Fractionné", "EF", "Seuil", "Renfo", "EF", "Sortie longue"],
  };
  return patterns[sessionsPerWeek] ?? patterns[3];
}

/**
 * Jours par défaut (0..6 = Lun..Dim)
 * Objectif : espacer les séances, SL en fin de semaine
 */
function defaultTrainingDays(sessionsPerWeek: SessionsPerWeek): readonly DowIndex[] {
  const defaults: Record<number, readonly DowIndex[]> = {
    2: [1, 5], // Mar / Sam
    3: [1, 3, 6], // Mar / Jeu / Dim
    4: [1, 3, 5, 6], // Mar / Jeu / Sam / Dim
    5: [0, 1, 3, 5, 6], // Lun / Mar / Jeu / Sam / Dim
    6: [0, 1, 2, 3, 5, 6], // Lun..Jeu + Sam + Dim
  };
  return defaults[sessionsPerWeek] ?? defaults[3];
}

/**
 * Dedup en conservant l'ordre utilisateur (respect intention).
 * Ne trie pas.
 */
function uniqDowKeepOrder(days: readonly number[]): DowIndex[] {
  const set = new Set<number>();
  const out: DowIndex[] = [];

  for (const d of days) {
    const i = Math.trunc(d);
    if (i < 0 || i > 6) continue;
    if (!set.has(i)) {
      set.add(i);
      out.push(i as DowIndex);
    }
  }

  return out;
}

/**
 * Construit les jours d'entraînement finaux (0..6):
 * 1) conserve l'ordre des jours demandés par l'utilisateur
 * 2) complète avec defaults
 * 3) fallback: remplit avec le reste de la semaine
 */
function buildTrainingDays(sessionsPerWeek: SessionsPerWeek, trainingDays?: readonly number[]): DowIndex[] {
  const wanted = trainingDays?.length ? uniqDowKeepOrder(trainingDays) : [];
  const defaults = defaultTrainingDays(sessionsPerWeek);

  const out: DowIndex[] = [];

  // 1) user first (order kept)
  for (const d of wanted) {
    if (out.length >= sessionsPerWeek) break;
    if (!out.includes(d)) out.push(d);
  }

  // 2) defaults
  for (const d of defaults) {
    if (out.length >= sessionsPerWeek) break;
    if (!out.includes(d)) out.push(d);
  }

  // 3) fallback fill
  for (let d = 0 as DowIndex; d <= 6 && out.length < sessionsPerWeek; d = (d + 1) as DowIndex) {
    if (!out.includes(d)) out.push(d);
  }

  return out.slice(0, sessionsPerWeek);
}

/* ------------------------------ normalization ------------------------------ */

type LevelKey = "beginner" | "regular" | "advanced";
type GoalKey = "weight" | "fitness" | "10k" | "half" | "marathon" | "other";

function normalizeLevelKey(level: Level): LevelKey {
  const v = normText(level);

  if (v.includes("debut") || v.includes("begin") || v.includes("novice")) return "beginner";
  if (v.includes("avanc") || v.includes("confirm") || v.includes("expert") || v.includes("advanced")) return "advanced";

  return "regular";
}

function normalizeGoalKey(goal: Goal): GoalKey {
  const v = normText(goal);

  if (v.includes("poids") || v.includes("weight") || v.includes("mincir") || v.includes("perte")) return "weight";
  if (v.includes("forme") || v.includes("fitness") || v.includes("sante") || v.includes("santé")) return "fitness";

  if (v.includes("10k") || v.includes("10km") || v.includes("10 km")) return "10k";
  if (v.includes("semi") || v.includes("half")) return "half";
  if (v.includes("mara")) return "marathon";

  return "other";
}

/* ------------------------------ templates --------------------------------- */

function templatesByLevel(level: Level): Record<WorkoutType, string> {
  const lk = normalizeLevelKey(level);

  const regular: Record<WorkoutType, string> = {
    EF: "45–60 min Z2",
    Fractionné: "8×400 m (récup 200 m)",
    Seuil: "3×8 min (récup 2 min)",
    "Sortie longue": "75–110 min facile",
    Renfo: "25 min (gainage + fentes)",
    Vélo: "60–75 min Z2",
    Repos: "Repos / mobilité 10 min",
  };

  if (lk === "beginner") {
    return {
      ...regular,
      EF: "30–45 min en aisance",
      Fractionné: "6×200 m (récup 200 m) léger",
      Seuil: "2×6 min (récup 2 min) confort soutenu",
      "Sortie longue": "45–70 min facile",
      Renfo: "15–20 min (gainage + jambes)",
      Vélo: "45–60 min Z2",
    };
  }

  if (lk === "advanced") {
    return {
      ...regular,
      EF: "55–70 min Z2",
      Fractionné: "10×500 m (récup 200 m)",
      Seuil: "2×15 min (récup 3 min)",
      "Sortie longue": "100–140 min facile",
      Renfo: "30 min (force + gainage)",
      Vélo: "75–90 min Z2",
    };
  }

  return regular;
}

function adjustForGoal(goal: Goal, workout: WorkoutType, details: string): string {
  const gk = normalizeGoalKey(goal);

  // objectifs “forme / poids” : moins agressif sur la qualité
  if (gk === "weight" || gk === "fitness") {
    if (workout === "Fractionné") return "6×200 m tranquille (technique + cadence)";
    if (workout === "Seuil") return "2×6 min confort soutenu (récup 2 min)";
    if (workout === "Sortie longue") return "50–95 min facile, régulier";
    return details;
  }

  if (gk === "10k") {
    if (workout === "Fractionné") return "8×400 m (récup 200 m) – allure 10 km";
    if (workout === "Seuil") return "3×8 min (récup 2 min) – soutenu";
    return details;
  }

  if (gk === "half") {
    if (workout === "Seuil") return "2×15 min (récup 3 min) – allure semi";
    if (workout === "Sortie longue") return "75–110 min facile";
    return details;
  }

  if (gk === "marathon") {
    if (workout === "Seuil") return "2×15 min (récup 3 min) – tempo contrôlé";
    if (workout === "Sortie longue") return "90–140 min facile";
    return details;
  }

  return details;
}

/* ---------------------------------- API ---------------------------------- */

export type GenerateWeeklyPlanArgs = {
  weekStartDate?: string; // "YYYY-MM-DD" (lundi)
  goal: Goal;
  level: Level;
  sessionsPerWeek: SessionsPerWeek | number; // number accepté, clamp
  trainingDays?: readonly number[]; // 0..6 (Lun..Dim)
};

/**
 * Génère une semaine complète (7 jours)
 * - jours non-entraînement => Repos (MVP)
 * - mapping pattern[i] -> trainingDays[i]
 */
export function generateWeeklyPlan(args: GenerateWeeklyPlanArgs): WeeklyPlan {
  const weekStartDate = args.weekStartDate ?? getMondayISO(new Date());
  const sessionsPerWeek = clampSessionsPerWeek(args.sessionsPerWeek);

  const pattern = workoutPattern(sessionsPerWeek);
  const trainingDays = buildTrainingDays(sessionsPerWeek, args.trainingDays);

  const templates = templatesByLevel(args.level);

  // associe pattern[i] à trainingDays[i]
  const mapByDow = new Map<DowIndex, WorkoutType>();
  trainingDays.forEach((dow, i) => {
    mapByDow.set(dow, (pattern[i] ?? "EF") as WorkoutType);
  });

  const daysArr: WeeklyPlanDay[] = [];
  for (let dow = 0 as DowIndex; dow <= 6; dow = (dow + 1) as DowIndex) {
    const workout = (mapByDow.get(dow) ?? "Repos") as WorkoutType;
    const baseDetails = templates[workout] ?? "—";
    const details = adjustForGoal(args.goal, workout, baseDetails);

    daysArr.push({
      dowIndex: dow,
      date: addDaysISO(weekStartDate, dow),
      workout,
      details,
    });
  }

  // ✅ tuple 7 jours garanti
  const days = daysArr as unknown as WeeklyPlanDays;

  return {
    id: uid("week"),
    weekStartDate,
    weekLabel: formatWeekLabelFR(weekStartDate),
    createdAt: nowMs(),
    source: "generated",
    days,
  };
}
