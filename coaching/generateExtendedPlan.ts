// coaching/generateExtendedPlan.ts
import type { ExtendedPlan, ISODate, PhaseId, LoadScore, WeekItem } from "./extendedPlan";
import { parseISODateLocal, toISODateLocal, weekStartFromISO, addDaysISO } from "@/coaching/dates";

/**
 * Generate ExtendedPlan (MVP+)
 * - tolérant sur args.goal/args.level
 * - phases (base/build/peak/recovery) + semaines numérotées
 * - dates optionnelles si startDate fourni (ISO local, semaine commence lundi)
 * - deload configurable
 */

type LevelKey = "beginner" | "regular" | "advanced";
type GoalKey = "10k" | "half" | "marathon" | "custom";

export type GenerateExtendedPlanArgs = {
  goal: string; // tolérant
  level: string; // tolérant
  startDate?: ISODate | string | Date; // si présent => weekStart/weekEnd remplis
  totalWeeks?: number; // override
  deloadEvery?: number; // 0 => off, sinon ex: 4 => 4,8,12...
  deloadOffset?: number; // 0 => semaine 4, 1 => semaine 5, etc.
  planVersion?: string; // ex "2026.01"
};

type PhaseSpec = {
  id: PhaseId;
  label: string;
  weeksCount: number;
  objective?: string;
};

/* -------------------------------- utils --------------------------------- */

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.max(min, Math.min(max, x));
}

function normalizeGoal(g: string): GoalKey {
  const v = String(g ?? "").toLowerCase().trim();
  if (v.includes("10")) return "10k";
  if (v.includes("semi") || v.includes("half")) return "half";
  if (v.includes("mar")) return "marathon";
  return "custom";
}

function normalizeLevel(l: string): LevelKey {
  const v = String(l ?? "").toLowerCase().trim();
  if (v.includes("beg") || v.includes("debut") || v.includes("début")) return "beginner";
  if (v.includes("adv") || v.includes("confirm") || v.includes("avanc")) return "advanced";
  return "regular";
}

/**
 * Parse startDate en ISODate (local safe)
 * - si Date => convertit en ISO local
 * - si string ISO => garde
 * - sinon tente parse Date(...) puis convertit
 */
function normalizeStartISO(sd?: ISODate | string | Date): ISODate | undefined {
  if (!sd) return undefined;

  if (sd instanceof Date) {
    if (!Number.isFinite(sd.getTime())) return undefined;
    return toISODateLocal(sd) as ISODate;
  }

  const s = String(sd).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s as ISODate;

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return undefined;
  return toISODateLocal(d) as ISODate;
}

function defaultTotalWeeks(goal: GoalKey, level: LevelKey) {
  // MVP: valeurs simples mais réalistes
  if (goal === "marathon") return level === "advanced" ? 16 : level === "beginner" ? 14 : 15;
  if (goal === "half") return level === "advanced" ? 12 : level === "beginner" ? 10 : 11;
  if (goal === "10k") return level === "advanced" ? 10 : level === "beginner" ? 8 : 9;
  return 10;
}

/**
 * Découpe des phases (semaines) par objectif / niveau.
 * - ratios + correction d'arrondis = somme exacte
 */
function phaseSpecs(goal: GoalKey, level: LevelKey, totalWeeks: number): PhaseSpec[] {
  // ratios par défaut
  let base = 0.45;
  let build = 0.35;
  let peak = 0.15;
  let recovery = 0.05;

  if (goal === "marathon") {
    base = 0.42;
    build = 0.38;
    peak = 0.15;
    recovery = 0.05;
  } else if (goal === "10k") {
    base = 0.40;
    build = 0.40;
    peak = 0.15;
    recovery = 0.05;
  }

  if (level === "beginner") {
    base += 0.05;
    build -= 0.02;
    peak -= 0.03;
  } else if (level === "advanced") {
    build += 0.03;
    base -= 0.02;
    peak += 0.01;
  }

  // clamp de sécurité
  base = Math.max(0.2, Math.min(0.65, base));
  build = Math.max(0.15, Math.min(0.55, build));
  peak = Math.max(0.05, Math.min(0.25, peak));
  recovery = Math.max(0.03, Math.min(0.15, recovery));

  // calc bruts
  let baseW = Math.max(2, Math.round(totalWeeks * base));
  let buildW = Math.max(2, Math.round(totalWeeks * build));
  let peakW = Math.max(1, Math.round(totalWeeks * peak));
  let recW = Math.max(1, totalWeeks - (baseW + buildW + peakW));

  // si recW a été écrasé
  if (baseW + buildW + peakW + recW !== totalWeeks) {
    recW = Math.max(1, totalWeeks - (baseW + buildW + peakW));
  }

  // correction si dépasse
  while (baseW + buildW + peakW + recW > totalWeeks) {
    if (buildW > 2) buildW--;
    else if (baseW > 2) baseW--;
    else if (peakW > 1) peakW--;
    else recW = Math.max(1, recW - 1);
  }

  // correction si manque
  while (baseW + buildW + peakW + recW < totalWeeks) {
    // prioriser base/build
    if (baseW <= buildW) baseW++;
    else buildW++;
  }

  return [
    { id: "base", label: "Base aérobie", weeksCount: baseW, objective: "Volume + régularité" },
    { id: "build", label: "Build / Intensité", weeksCount: buildW, objective: "Qualité progressive" },
    { id: "peak", label: "Peak / Objectif", weeksCount: peakW, objective: "Spécifique objectif" },
    { id: "recovery", label: "Récupération", weeksCount: recW, objective: "Assimilation + fraîcheur" },
  ];
}

/* -------------------------------- generator ------------------------------ */

export function generateExtendedPlan(args: GenerateExtendedPlanArgs): ExtendedPlan {
  const goalKey = normalizeGoal(args.goal);
  const levelKey = normalizeLevel(args.level);

  const totalWeeks = clampInt(args.totalWeeks ?? defaultTotalWeeks(goalKey, levelKey), 4, 24, 10);

  const deloadEvery = clampInt(args.deloadEvery ?? 4, 0, 12, 4); // 0 => off
  const deloadOffset = clampInt(args.deloadOffset ?? 0, 0, 11, 0); // 0 => 4,8,12... ; 1 => 5,9,13...

  const startISO = normalizeStartISO(args.startDate);

  // semaine 1 = semaine (lundi) contenant startISO (si fourni)
  const week1StartISO: ISODate | undefined = startISO ? (weekStartFromISO(startISO) as ISODate) : undefined;

  const specs = phaseSpecs(goalKey, levelKey, totalWeeks);

  let weekIndex = 1;

  const phases: ExtendedPlan["phases"] = specs.map((ph) => {
    const weeks: WeekItem[] = Array.from({ length: ph.weeksCount }).map(() => {
      const wi = weekIndex++;

      const isDeload =
        deloadEvery > 0 ? ((wi - deloadOffset) % deloadEvery === 0) && wi !== 0 : false;

      const weekStart = week1StartISO ? (addDaysISO(week1StartISO, (wi - 1) * 7) as ISODate) : undefined;
      const weekEnd = weekStart ? (addDaysISO(weekStart, 6) as ISODate) : undefined;

      const item: WeekItem = {
        weekIndex: wi,
        weekLabel: isDeload ? `Semaine ${wi} • allégée` : `Semaine ${wi}`,
      };

      if (weekStart) item.weekStart = weekStart;
      if (weekEnd) item.weekEnd = weekEnd;
      if (isDeload) item.isDeload = true;

      // optionnel: targetLoad simple (tu peux l'affiner plus tard)
      // exemple: légère baisse en deload, progression douce sinon
      const baseLoad = 45 + Math.min(35, Math.round((wi / totalWeeks) * 35)); // 45..80
      const target = isDeload ? Math.round(baseLoad * 0.82) : baseLoad;
      item.targetLoad = Math.max(10, Math.min(95, target)) as LoadScore;

      return item;
    });

    return {
      id: ph.id,
      label: ph.label,
      objective: ph.objective,
      // start/end phase (si on a weekStart)
      ...(weeks[0]?.weekStart ? { startDate: weeks[0].weekStart } : {}),
      ...(weeks[weeks.length - 1]?.weekEnd ? { endDate: weeks[weeks.length - 1].weekEnd } : {}),
      weeks,
    };
  });

  return {
    goal: goalKey,
    level: levelKey,
    startDate: week1StartISO,
    planVersion: args.planVersion ?? "mvp",
    phases,
    meta: {
      generator: "generateExtendedPlan@v1.1",
      totalWeeks,
      deloadEvery,
      deloadOffset,
      normalized: { goalKey, levelKey },
    },
  };
}
