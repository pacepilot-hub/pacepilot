// coaching/calibrationPlan.ts

export type SportKey = "run" | "trail" | "bike" | "swim" | "gym" | "other";
export type ElevationProfile = "flat" | "rolling" | "mountain";

export type WorkoutType =
  | "REST"
  | "EF"
  | "SL"
  | "TEMPO"
  | "INTERVALS"
  | "STRIDES"
  | "STRENGTH"
  | "CROSS";

export type CalibrationStatus = "not_started" | "in_progress" | "done";

export type CalibrationState = {
  requiredSessions: number;
  completedSessions: number;
  status: CalibrationStatus;
  // recommandé pour éviter les incohérences si l’utilisateur change d’objectif/sport
  contextHash?: string;
};

export type OnboardingTrainingPrefs = {
  sessionsPerWeek: number; // 2..7
  primarySport?: SportKey;
  enabledSports?: SportKey[];
  autoReschedule?: { enabled: boolean; allowedDays: number[] }; // 0..6 (Mon..Sun) recommandé
  goal?: {
    discipline?: "road" | "trail";
    elevationProfile?: ElevationProfile;
  };
};

export type WeeklyPlanDay = {
  // ✅ compatible avec ton UI Home (workoutLabel/coachingWhyText)
  workout: string; // ex "EF", "Sortie longue", "Fractionné", "Repos"
  details?: string; // explication / consignes

  // ✅ multi-sport ready
  sport?: SportKey;
  workoutType?: WorkoutType;

  // champs optionnels si tu veux ensuite alimenter Plan / Map
  target?: {
    durationMin?: number;
    distanceKm?: number;
    notes?: string;
  };
};

export type WeeklyPlan = {
  days: WeeklyPlanDay[];
  meta?: {
    kind?: "calibration" | "training";
    weekIndex?: number;
    phaseKey?: string;
    objectiveLabel?: string;
  };
};

/* ---------------------------------- rules --------------------------------- */

export function requiredCalibrationSessions(sessionsPerWeek: number): number {
  const spw = clampInt(sessionsPerWeek, 2, 7);

  if (spw <= 3) return 3;
  if (spw === 4) return 4;
  if (spw === 5) return 5;
  return 6; // 6+
}

export function buildCalibrationContextHash(p: OnboardingTrainingPrefs): string {
  const spw = clampInt(p.sessionsPerWeek, 2, 7);
  const sport = p.primarySport ?? "run";
  const discipline = p.goal?.discipline ?? "road";
  const elev = p.goal?.elevationProfile ?? "flat";
  const allowed = Array.isArray(p.autoReschedule?.allowedDays) ? p.autoReschedule!.allowedDays.join(",") : "any";
  return `calib|spw:${spw}|sport:${sport}|disc:${discipline}|elev:${elev}|days:${allowed}`;
}

/**
 * Génère une semaine "mini-plan de calibrage".
 * - Place N séances (N = requiredCalibrationSessions) sur des jours autorisés
 * - Remplit le reste en repos (ou option cross-training léger)
 */
export function generateCalibrationWeek(p: OnboardingTrainingPrefs): WeeklyPlan {
  const spw = clampInt(p.sessionsPerWeek, 2, 7);
  const required = requiredCalibrationSessions(spw);

  const primarySport: SportKey = p.primarySport ?? "run";

  // Jours autorisés (0..6 Mon..Sun). Si non fourni => on choisit une répartition simple.
  const allowedDays =
    Array.isArray(p.autoReschedule?.allowedDays) && p.autoReschedule!.allowedDays.length > 0
      ? uniqSorted(p.autoReschedule!.allowedDays.map((d) => clampInt(d, 0, 6)))
      : defaultAllowedDays(spw);

  // On choisit les jours d’entraînement pour caser "required" séances.
  const trainDays = pickTrainingDays(allowedDays, required);

  // On construit les séances (ordre = progressif, safe)
  const sessions = buildCalibrationSessions(required, primarySport);

  // Assemblage semaine (7 jours)
  const days: WeeklyPlanDay[] = Array.from({ length: 7 }).map((_, idx) => {
    const si = trainDays.indexOf(idx);
    if (si === -1) {
      return {
        workout: "Repos",
        details: "→ Assimilation. Le repos fait partie du calibrage.",
        sport: "other",
        workoutType: "REST",
      };
    }
    return sessions[si] ?? {
      workout: "Footing facile",
      details: "→ Séance de calibrage. Reste en aisance respiratoire.",
      sport: primarySport,
      workoutType: "EF",
      target: { durationMin: 30 },
    };
  });

  return {
    days,
    meta: {
      kind: "calibration",
      weekIndex: 1,
      phaseKey: "calibration",
      objectiveLabel: "Calibrage",
    },
  };
}

/**
 * Utilitaire : incrémente le calibrage après une séance validée.
 */
export function markCalibrationSessionDone(state: CalibrationState): CalibrationState {
  const required = Math.max(1, state.requiredSessions);
  const completed = clampInt(state.completedSessions + 1, 0, required);

  const status: CalibrationStatus = completed >= required ? "done" : "in_progress";

  return { ...state, completedSessions: completed, status };
}

/* ----------------------------- session templates ---------------------------- */

function buildCalibrationSessions(n: number, sport: SportKey): WeeklyPlanDay[] {
  // V1 “safe” : EF + éducatifs + 1 tempo + 1 “longue” si n>=4 + 1 intervals court si n>=5
  // Objectif : mesurer endurance/aisance, tolérance tempo, un peu de vitesse sans te cramer.

  const out: WeeklyPlanDay[] = [];

  // 1) EF test (base)
  out.push({
    workout: "Footing facile",
    details: "→ 30–40 min en aisance. Objectif : calibrer l’endurance (RPE 3/10).",
    sport,
    workoutType: "EF",
    target: { durationMin: 35, notes: "Respiration facile, relâché." },
  });

  // 2) EF + lignes droites (coordination)
  if (n >= 2) {
    out.push({
      workout: "EF + lignes droites",
      details: "→ 25–35 min EF + 6×20s vite (récup 60s). Objectif : coordination, sans fatigue.",
      sport,
      workoutType: "STRIDES",
      target: { durationMin: 35, notes: "Les 20s doivent rester propres, pas à bloc." },
    });
  }

  // 3) Tempo léger (seuil bas)
  if (n >= 3) {
    out.push({
      workout: "Tempo léger",
      details: "→ 15 min EF + 3×6 min tempo (récup 2 min) + 10 min EF. Objectif : allure tenable.",
      sport,
      workoutType: "TEMPO",
      target: { durationMin: 50, notes: "Tempo = soutenu mais contrôlé (RPE 6/10)." },
    });
  }

  // 4) Sortie longue (si on a assez de séances)
  if (n >= 4) {
    out.push({
      workout: "Sortie longue",
      details: "→ 60–75 min EF. Objectif : endurance + tolérance au volume.",
      sport,
      workoutType: "SL",
      target: { durationMin: 70, notes: "Reste très facile. On veut du solide, pas de l’héroïsme." },
    });
  }

  // 5) Intervalles courts “safe”
  if (n >= 5) {
    out.push({
      workout: "Fractionné court",
      details: "→ 15 min EF + 8×1 min vite (récup 1 min) + 10 min EF. Objectif : repères vitesse.",
      sport,
      workoutType: "INTERVALS",
      target: { durationMin: 45, notes: "Vite = dynamique, pas sprint (RPE 7/10 max)." },
    });
  }

  // 6) Renfo / cross (optionnel) si n>=6
  if (n >= 6) {
    out.push({
      workout: "Renfo léger",
      details: "→ 20–30 min gainage / mobilité. Objectif : stabilité + prévention.",
      sport: "gym",
      workoutType: "STRENGTH",
      target: { durationMin: 25, notes: "Qualité d’exécution > quantité." },
    });
  }

  // Si n > ce qu’on a, on complète avec EF.
  while (out.length < n) {
    out.push({
      workout: "Footing facile",
      details: "→ 30–40 min en aisance. Objectif : compléter le calibrage sans fatigue.",
      sport,
      workoutType: "EF",
      target: { durationMin: 35 },
    });
  }

  return out.slice(0, n);
}

/* -------------------------------- day picking ------------------------------ */

function pickTrainingDays(allowedDays: number[], required: number): number[] {
  const a = uniqSorted(allowedDays);
  if (a.length === 0) return [];

  // Si allowedDays contient moins que required, on boucle (mais on évite de dépasser 7)
  if (a.length >= required) {
    // On espace au mieux : on prend une distribution sur la semaine
    // ex allowed [0,2,4,6] required 3 -> [0,2,4]
    return a.slice(0, required);
  }

  const picked: number[] = [];
  let i = 0;
  while (picked.length < required && picked.length < 7) {
    picked.push(a[i % a.length]);
    i++;
  }

  // dédoublonnage + si pas assez, on ajoute des jours “voisins” libres
  const uniq = uniqSorted(picked);
  if (uniq.length >= required) return uniq.slice(0, required);

  // ajoute des jours libres proches (safe)
  const set = new Set(uniq);
  for (let step = 1; uniq.length < required && step <= 3; step++) {
    for (const d of a) {
      const cand1 = clampInt(d + step, 0, 6);
      const cand2 = clampInt(d - step, 0, 6);
      if (!set.has(cand1)) {
        set.add(cand1);
        uniq.push(cand1);
        if (uniq.length >= required) break;
      }
      if (!set.has(cand2)) {
        set.add(cand2);
        uniq.push(cand2);
        if (uniq.length >= required) break;
      }
    }
  }

  return uniqSorted(uniq).slice(0, required);
}

function defaultAllowedDays(spw: number): number[] {
  // 0..6 = Mon..Sun
  // répartition simple : 2-> [1,4], 3->[0,2,5], 4->[0,2,4,6], 5->[0,1,3,4,6], 6/7->[0..6] sauf 1 repos
  const s = clampInt(spw, 2, 7);
  if (s === 2) return [1, 4]; // Tue, Fri
  if (s === 3) return [0, 2, 5]; // Mon, Wed, Sat
  if (s === 4) return [0, 2, 4, 6]; // Mon Wed Fri Sun
  if (s === 5) return [0, 1, 3, 4, 6]; // Mon Tue Thu Fri Sun
  if (s === 6) return [0, 1, 2, 4, 5, 6]; // Wed repos (3)
  return [0, 1, 2, 3, 4, 5, 6]; // 7
}

/* --------------------------------- helpers -------------------------------- */

function uniqSorted(arr: number[]): number[] {
  return Array.from(new Set(arr)).sort((a, b) => a - b);
}

function clampInt(n: any, a: number, b: number): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, Math.trunc(x)));
}
