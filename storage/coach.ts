// storage/coach.ts
import type { Activity } from "./types";
import { buildLoadSeries, summarizeLoad } from "../storage/metrics";

export type CoachAdvice = {
  level: "info" | "warning" | "success";
  title: string;
  details: string[];
  /** optionnel: une phrase style “coach” (drôle / motivante) */
  coachLine?: string;
};

/* --------------------------------- helpers -------------------------------- */

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function safeToFixed(n: unknown, digits = 1, fallback = "—"): string {
  if (!isFiniteNumber(n)) return fallback;
  return n.toFixed(digits);
}

function safeTrim(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseDateMaybe(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;

  // ⚠️ tolère YYYY-MM-DD et ISO complets
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Essaie de lire une date sur plusieurs champs possibles,
 * sans imposer que le type Activity les expose formellement.
 */
function readActivityDate(a: Activity): Date | null {
  const obj = a as unknown as Record<string, unknown>;
  return parseDateMaybe(obj.date) ?? parseDateMaybe(obj.startAt) ?? parseDateMaybe(obj.startedAt) ?? null;
}

/**
 * Tri stable par date croissante si possible.
 * Si dates manquantes: conserve l’ordre d’entrée.
 */
function sortByDateAsc(activities: Activity[]): Activity[] {
  const withIdx = activities.map((a, i) => ({ a, i, d: readActivityDate(a) }));
  const hasAnyDate = withIdx.some((x) => x.d);

  if (!hasAnyDate) return activities.slice();

  return withIdx
    .slice()
    .sort((x, y) => {
      const dx = x.d?.getTime();
      const dy = y.d?.getTime();

      if (dx == null && dy == null) return x.i - y.i;
      if (dx == null) return -1;
      if (dy == null) return 1;
      if (dx !== dy) return dx - dy;
      return x.i - y.i;
    })
    .map((x) => x.a);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function safeArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/* --------------------------- sport / intensity ---------------------------- */

/**
 * On reste volontairement tolérant: le type Activity peut évoluer.
 * On lit "sport" ou "kind" si dispo.
 */
type SportBucket = "run" | "trail" | "bike" | "walk" | "swim" | "unknown";

function readSportBucket(a: Activity): SportBucket {
  const obj = a as unknown as Record<string, unknown>;

  const sport = safeTrim(obj.sport).toLowerCase(); // ex: "Course", "Vélo"
  const kind = safeTrim(obj.kind).toLowerCase(); // ex: "run", "bike", "trail_run"
  const type = safeTrim(obj.type).toLowerCase(); // fallback legacy

  // 1) kind prioritaire si déjà normalisé
  if (kind === "run") return "run";
  if (kind === "trail_run" || kind === "trail") return "trail";
  if (kind === "bike" || kind === "cycling") return "bike";
  if (kind === "walk" || kind === "hike") return "walk";
  if (kind === "swim" || kind === "swimming") return "swim";

  // 2) sport (UI)
  if (sport.includes("course")) return "run";
  if (sport.includes("trail")) return "trail";
  if (sport.includes("vélo") || sport.includes("velo") || sport.includes("bike")) return "bike";
  if (sport.includes("marche") || sport.includes("rando")) return "walk";
  if (sport.includes("natation") || sport.includes("swim")) return "swim";

  // 3) legacy "type"
  if (type === "cross") return "bike";
  // easy/tempo/intervals/long/race -> course
  if (type === "easy" || type === "tempo" || type === "intervals" || type === "long" || type === "race") return "run";

  return "unknown";
}

/**
 * Intensité “hard/easy”.
 * - si intensité inconnue: easy par prudence.
 */
function intensityBucket(a: Activity): "hard" | "easy" {
  const obj = a as unknown as Record<string, unknown>;
  const v = safeTrim(obj.intensity).toLowerCase();
  return v === "threshold" || v === "interval" || v === "race" ? "hard" : "easy";
}

function countIntensity(acts: Activity[]) {
  let hard = 0;
  let easy = 0;

  for (const a of acts) {
    if (intensityBucket(a) === "hard") hard += 1;
    else easy += 1;
  }

  const total = hard + easy;
  return {
    hard,
    easy,
    total,
    hardPct: total ? (hard / total) * 100 : 0,
  };
}

/**
 * Fenêtre 7 jours:
 * - prend la dernière date valide
 * - filtre [last-6j .. last]
 * - sinon fallback N dernières
 */
function takeLast7DaysOrLastN(sortedAsc: Activity[], fallbackN = 7): Activity[] {
  if (!sortedAsc.length) return [];

  let lastDate: Date | null = null;
  for (let i = sortedAsc.length - 1; i >= 0; i--) {
    const d = readActivityDate(sortedAsc[i]);
    if (d) {
      lastDate = d;
      break;
    }
  }
  if (!lastDate) return sortedAsc.slice(-fallbackN);

  const start = new Date(lastDate);
  start.setDate(start.getDate() - 6);

  const within = sortedAsc.filter((a) => {
    const d = readActivityDate(a);
    if (!d) return false;
    return d >= start && d <= lastDate!;
  });

  return within.length >= 3 ? within : sortedAsc.slice(-fallbackN);
}

/* ------------------------------ coach voice ------------------------------- */

/**
 * Coach "tutoiement" + punchlines.
 * - Non insultant
 * - Pas de médical
 * - Ajustable plus tard (tu brancheras tes 100 phrases/catégorie)
 */
type CoachLineKind = "fresh" | "fatigue" | "tooHard" | "needHard" | "balanced" | "start";

function pickOne(seed: string, options: string[]) {
  if (!options.length) return "";
  // hash simple déterministe
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % options.length;
  return options[idx];
}

function coachLine(kind: CoachLineKind, seed: string): string {
  const bank: Record<CoachLineKind, string[]> = {
    start: [
      "On commence tranquille : une séance enregistrée, et je deviens déjà plus malin.",
      "Tu mets une première brique, je te construis un plan béton.",
      "Bienvenue ! Donne-moi des séances, je te rends des progrès.",
    ],
    fresh: [
      "Aujourd’hui t’es frais : on peut envoyer… intelligemment.",
      "Feu vert. Mais pas mode fusée sur la première minute 😄",
      "T’as de l’énergie : on l’utilise sans la cramer.",
    ],
    fatigue: [
      "Alerte : batterie basse. Recharge avant de vouloir performer.",
      "Si tu forces là… ça va péter. On calme et on récupère.",
      "Tu veux progresser ? Aujourd’hui, la meilleure séance c’est la sagesse.",
    ],
    tooHard: [
      "Ton ego veut sprinter tous les jours. Ton corps, lui, veut durer.",
      "Trop de dur d’un coup : ralentis ou ça va te présenter l’addition.",
      "On n’empile pas les séances dures comme des pancakes. Une à la fois.",
    ],
    needHard: [
      "Tu es régulier, c’est top. Maintenant on ajoute une petite séance clé, propre.",
      "Un peu d’intensité et tu passes un cap. Une seule, bien placée.",
      "Tu roules en mode diesel : on met un turbo… une fois par semaine 😄",
    ],
    balanced: [
      "Équilibre propre. Continue comme ça, c’est du bon boulot.",
      "Ton ratio est nickel : facile facile, dur efficace.",
      "Tu fais les choses bien. C’est comme ça qu’on gagne sur le long terme.",
    ],
  };

  return pickOne(`${kind}|${seed}`, bank[kind]);
}

/* ------------------------------ advice builder ---------------------------- */

function pushAdvice(
  out: CoachAdvice[],
  level: CoachAdvice["level"],
  title: string,
  details: string[],
  coachLineMaybe?: string
) {
  const cleanDetails = details
    .map((x) => safeTrim(x))
    .filter(Boolean)
    .slice(0, 4); // UI-safe

  out.push({
    level,
    title: safeTrim(title) || "Conseil",
    details: cleanDetails,
    coachLine: coachLineMaybe ? safeTrim(coachLineMaybe) || undefined : undefined,
  });
}

/* ---------------------------------- main ---------------------------------- */

/**
 * “IA coach” bêta :
 * - charge (si dispo)
 * - intensité récente (si sport = run/trail)
 * - anti-enchaînement
 * - coachLine (drôle/motivant)
 */
export function generateCoachAdvice(activities: Activity[]): CoachAdvice[] {
  const actsInput = Array.isArray(activities) ? activities : [];
  const acts = actsInput.filter(Boolean);

  const sortedAsc = sortByDateAsc(acts);

  if (sortedAsc.length === 0) {
    return [
      {
        level: "info",
        title: "Démarrer",
        details: [
          "Ajoute une première activité pour estimer ta charge et tes tendances.",
          "Astuce : renseigne l’intensité (facile / seuil / intervalles / course) pour des conseils plus précis.",
        ],
        coachLine: coachLine("start", "no-acts"),
      },
    ];
  }

  const adv: CoachAdvice[] = [];

  // Seed stable pour varier les punchlines
  const last = sortedAsc[sortedAsc.length - 1];
  const seed = `${safeTrim((last as any).id)}|${safeTrim((last as any).date)}|${sortedAsc.length}`;

  // Sport bucket dominant sur la période récente
  const recentForSport = takeLast7DaysOrLastN(sortedAsc, 10);
  const buckets = recentForSport.map(readSportBucket);
  const counts: Record<SportBucket, number> = { run: 0, trail: 0, bike: 0, walk: 0, swim: 0, unknown: 0 };
  for (const b of buckets) counts[b] += 1;

  const dominant = (Object.keys(counts) as SportBucket[]).reduce((best, k) =>
    counts[k] > counts[best] ? k : best
  , "unknown" as SportBucket);

  // 1) Charge / tendance (ATL/CTL/TSB) — global (même multi-sport, si tes metrics le supportent)
  let sum: ReturnType<typeof summarizeLoad> | null = null;
  try {
    const series = buildLoadSeries(sortedAsc);
    sum = summarizeLoad(series);
  } catch {
    sum = null;
  }

  if (sum?.last) {
    const { last: lastLoad, trend } = sum;
    const tsbStr = safeToFixed((lastLoad as unknown as { tsb?: unknown }).tsb, 1);

    if (trend === "fatigue_high") {
      pushAdvice(adv, "warning", "Fatigue élevée", [
        `TSB ≈ ${tsbStr} (forme - fatigue).`,
        "Recommandation : 1–2 jours faciles (ou repos) + sommeil / stress à surveiller.",
        "Prochaine séance : facile, courte, sans intensité.",
      ], coachLine("fatigue", seed));
    } else if (trend === "fresh") {
      pushAdvice(adv, "success", "Bonne fraîcheur", [
        `TSB ≈ ${tsbStr}.`,
        "Si ton planning le prévoit, tu peux placer une séance clé.",
        "Garde 24–48h faciles ensuite pour absorber la charge.",
      ], coachLine("fresh", seed));
    } else {
      pushAdvice(adv, "info", "Charge maîtrisée", [
        `TSB ≈ ${tsbStr}.`,
        "Continue : 1 séance clé max, le reste en facile pour consolider.",
      ]);
    }
  } else {
    pushAdvice(adv, "info", "Suivi en cours", [
      "Je n’ai pas assez de données fiables pour calculer une tendance de charge.",
      "Continue à enregistrer tes séances : après 10–14 jours, les tendances deviennent utiles.",
    ]);
  }

  // 2) Intensité récente
  // ⚠️ Pour l’instant on applique les heuristiques “80/20” uniquement si dominant = run/trail.
  // Pour bike/swim/walk: on laisse juste charge + anti-streak (safe).
  const applyIntensityHeuristics = dominant === "run" || dominant === "trail";

  const recent = takeLast7DaysOrLastN(sortedAsc, 7);
  const dist = countIntensity(recent);

  if (applyIntensityHeuristics && dist.total >= 4) {
    const hardPct = dist.hardPct;

    // cible générique pour course/trail
    const targetMin = 15;
    const targetMax = 30;

    if (hardPct > 35) {
      pushAdvice(adv, "warning", "Trop d’intensité récente", [
        `~${hardPct.toFixed(0)}% des séances récentes sont “dures” (${dist.hard}/${dist.total}).`,
        "Repère simple : vise ~20–30% dur, ~70–80% facile.",
        "Ajustement : remplace la prochaine séance dure par une sortie facile + éducatifs.",
      ], coachLine("tooHard", seed));
    } else if (hardPct < 10) {
      pushAdvice(adv, "info", "Peu d’intensité récente", [
        `~${hardPct.toFixed(0)}% des séances récentes sont “dures” (${dist.hard}/${dist.total}).`,
        "Si objectif performance, 1 séance seuil OU intervalles/semaine peut aider.",
        "Règle : jamais deux séances dures à la suite, et du facile entre les deux.",
      ], coachLine("needHard", seed));
    } else if (hardPct >= targetMin && hardPct <= targetMax) {
      pushAdvice(adv, "success", "Répartition cohérente", [
        `Répartition récente OK : ${dist.hard}/${dist.total} séances dures (~${hardPct.toFixed(0)}%).`,
        "Garde le facile vraiment facile : c’est ça qui rend les séances clés efficaces.",
      ], coachLine("balanced", seed));
    }
  }

  // 3) Anti “dures en série” (sur les 3 dernières)
  if (sortedAsc.length >= 3) {
    const last3 = sortedAsc.slice(-3);
    const hardCount = last3.reduce((acc, a) => acc + (intensityBucket(a) === "hard" ? 1 : 0), 0);

    // si intensité non renseignée: hardCount reste bas => prudence OK
    if (hardCount >= 2) {
      pushAdvice(adv, "warning", "Attention à l’enchaînement", [
        "Tu as plusieurs séances “dures” sur les dernières activités.",
        "Conseil : insère 1–2 séances faciles avant la prochaine intensité.",
      ], coachLine("tooHard", `${seed}|streak`));
    }
  }

  // 4) Multi-sport: info courte si dominant ≠ run/trail (pour expliquer le “pourquoi” sans être relou)
  if (!applyIntensityHeuristics) {
    const label =
      dominant === "bike" ? "vélo" :
      dominant === "swim" ? "natation" :
      dominant === "walk" ? "marche/rando" :
      "multi-sport";

    pushAdvice(adv, "info", "Multi-sport", [
      `Je détecte surtout du ${label} sur la période récente.`,
      "Pour l’instant, je me base surtout sur la charge et la récupération (les règles d’intensité seront adaptées sport par sport).",
    ]);
  }

  // 5) Sécurité: si aucune advice (rare)
  if (adv.length === 0) {
    pushAdvice(adv, "info", "Conseil du jour", ["Continue régulièrement, et ajuste selon ton ressenti."]);
  }

  return adv;
}
