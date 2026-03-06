// storage/constants.ts

/**
 * Constantes produit + clés AsyncStorage
 * - Pas de logique "validation" ici (ça va dans validators.ts)
 * - Builders de clés versionnées => moins d'erreurs
 */

/* --------------------------------- app ----------------------------------- */

export const APP = {
  name: "PacePilot",
  timezone: "Europe/Paris",
} as const;

/* --------------------------- AsyncStorage namespaces ----------------------- */

/**
 * Convention:
 * - Les storages versionnés doivent exposer une fonction key(v)
 * - Ça évite de hardcoder "v1" ici alors que le fichier bump une version
 */
export const STORAGE = {
  auth: {
    token: "pacepilot:auth:token",
    userId: "pacepilot:auth:user_id",
  },

  onboarding: {
    v3: "pacepilot:onboarding:v3",
    legacy: ["pacepilot:onboarding:v2", "pacepilot:onboarding:v1", "pacepilot:onboarding"] as const,
  },

  userProfile: {
    // userProfile.ts => namespace "pacepilot.userProfile" + version 1 => "pacepilot.userProfile.v1"
    key(version: number) {
      return `pacepilot.userProfile.v${version}`;
    },
    currentVersion: 1,
  },

  activities: {
    v1: "pacepilot.activities.v1",
    v2: "pacepilot.activities.v2",
  },

  weeklyPlan: {
    base: "pacepilot.weeklyPlan",
    key(version: number) {
      return `${this.base}.v${version}`;
    },
    currentVersion: 1,
  },

  trainingPlan: {
    base: "pacepilot:trainingPlan",
    key(version: number) {
      return `${this.base}:v${version}`;
    },
    currentVersion: 1,
  },

  routes: {
    v2: "pacepilot.routes.v2",
  },

  checkins: {
    dailyLastShown: "pp_checkin_daily_last_shown",
    dailyLastAnswer: "pp_checkin_daily_last_answer",
    postPending: "pp_checkin_post_pending",
    postLastAnswer: "pp_checkin_post_last_answer",
    postLastActivityId: "pp_checkin_post_last_activity_id",
  },
} as const;

/* --------------------------------- sports -------------------------------- */

/**
 * Sports "produit" (multi-sport)
 * - L'app peut permettre multi-select onboarding
 * - Mais côté UI actuel (storage/types.ts), SportType est plus petit.
 * => on garde 2 notions:
 * 1) SportFocus (produit / objectifs / onboarding)
 * 2) SportType UI (affichage simple activités) déjà défini dans storage/types.ts
 */
export const SPORT_FOCUS = ["Course", "Trail", "Vélo route", "VTT", "Randonnée", "Natation"] as const;
export type SportFocus = (typeof SPORT_FOCUS)[number];

/** Sports activables au lancement (MVP) */
export const MVP_SPORT_FOCUS: readonly SportFocus[] = ["Course", "Trail"] as const;

/* ---------------------------------- DOW ---------------------------------- */

/**
 * ⚠️ Tu as déjà des labels dans storage/types.ts (DOW_LABELS).
 * Ici on garde seulement des labels "produit" si tu en as vraiment besoin.
 * Sinon, supprime cette section et importe depuis storage/types.ts.
 */
export const DOW_FR = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"] as const;
export type DowFrLabel = (typeof DOW_FR)[number];

/** 0..6 (Lun..Dim) : garde seulement si tu l'utilises partout */
export type DowIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/* ------------------------------ calibration ------------------------------- */

export const CALIBRATION = {
  minSessions: 3,
  maxSessions: 6,

  /**
   * sessionsPerWeek -> nb calibrage
   * - 1 => 3
   * - 2 => 4
   * - 3 => 5
   * - 4..6 => 6
   */
  sessionsByFrequency(sessionsPerWeek: number): number {
    const f = Math.max(1, Math.min(6, Math.round(sessionsPerWeek)));
    if (f <= 1) return 3;
    if (f === 2) return 4;
    if (f === 3) return 5;
    return 6;
  },
} as const;

/* -------------------------------- injuries -------------------------------- */

export const INJURY_SEVERITY = ["Faible", "Moyenne", "Forte"] as const;
export type InjurySeverity = (typeof INJURY_SEVERITY)[number];

export type Injury = Readonly<{
  zone: string; // "genou", "mollet", etc.
  severity: InjurySeverity;
  dateISO: string; // "YYYY-MM-DD"
}>;

/* ---------------------------- coach personality --------------------------- */

export const COACH = {
  tutoiement: true,
  style: "friendly" as const, // future: "serious" | "friendly" | "toughLove"
  maxReasonsText: 3,
  maxAdviceDetails: 4,
} as const;
