// storage/onboarding.schema.ts
import { z } from "zod";

/**
 * V4 — Onboarding "PacePilot" (beta-ready)
 * Objectif:
 * - Capturer le profil + préférences pour démarrer le coach
 * - Support multi-sport (sélection multiple)
 * - Blessures structurées (zone + gravité + date)
 * - Préférences de planning + autorisation de déplacement des séances
 * - Calibrage: nombre de séances dérivé du nb de séances/semaine (min 3, max 6)
 *
 * Notes:
 * - On garde une UX fluide: beaucoup de champs restent optionnels
 * - Les transforms appliquent defaults + sanitation + cohérence
 */

/* --------------------------------- helpers -------------------------------- */

const IsoDateString = z
  .string()
  .refine((s) => Number.isFinite(new Date(s).getTime()), "Invalid date string");

const YmdString = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), "Expected YYYY-MM-DD");

const DayOfWeekSchema = z.number().int().min(0).max(6); // 0=Lun … 6=Dim

function clampInt(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function uniqSorted(nums: number[]) {
  return Array.from(new Set(nums)).sort((a, b) => a - b);
}

/* --------------------------------- enums --------------------------------- */

export const SexSchema = z.enum(["Homme", "Femme", "Autre", "Non précisé"]);
export type Sex = z.infer<typeof SexSchema>;

export const SportSchema = z.enum([
  "Course à pied",
  "Trail",
  "Triathlon",
  "Biathlon",
  "Vélo route",
  "VTT",
  "Randonnée",
  "Natation",
  "Fitness",
  "Yoga",
  "Mobilité",
  "CrossFit",
  "HIIT",
  "Calisthenics",
  "Musculation",
]);
export type Sport = z.infer<typeof SportSchema>;

export const GoalSchema = z.enum([
  "Forme",
  "Perte de poids",
  "5 km",
  "10 km",
  "Semi-marathon",
  "Marathon",
  "Trail (objectif)",
]);
export type Goal = z.infer<typeof GoalSchema>;

export const LevelSchema = z.enum(["Débutant", "Intermédiaire", "Avancé", "Élite"]);
export type Level = z.infer<typeof LevelSchema>;

/**
 * ✅ On accepte 1..6 (tu as explicitement “1 jour/semaine”)
 */
export const SessionsPerWeekSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export type SessionsPerWeek = z.infer<typeof SessionsPerWeekSchema>;

/* --------------------------------- injuries -------------------------------- */

export const InjurySeveritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type InjurySeverity = z.infer<typeof InjurySeveritySchema>;

export const InjurySchema = z
  .object({
    /** ex: "Tendinite", "Entorse", "Douleur" */
    type: z.string().trim().min(2).max(60).optional(),

    /** ex: "Genou droit", "Tendon d'Achille" */
    zone: z.string().trim().min(2),

    /** 1=léger, 2=moyen, 3=sévère (pas un diagnostic) */
    severity: InjurySeveritySchema,

    /** YYYY-MM-DD (date de début / apparition) */
    date: YmdString,

    /** optionnel: note libre */
    note: z.string().trim().max(280).optional(),
  })
  .strict();

export type Injury = z.infer<typeof InjurySchema>;

const AvailabilitySchema = z
  .object({
    trainingDays: z.array(DayOfWeekSchema).min(1).max(6),
    sessionDurationMin: z.number().int().min(15).max(240),
  })
  .strict();

const LocationSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    city: z.string().trim().min(1).max(80).optional(),
    terrain: z.enum(["Montagne", "Plaine", "Littoral"]).optional(),
    weatherNote: z.string().trim().max(120).optional(),
  })
  .strict();

const PhysiologySchema = z
  .object({
    hrMax: z.number().int().min(100).max(240).optional(),
    hrMaxMeasured: z.boolean().optional(),
    hrRest: z.number().int().min(25).max(120).optional(),
    hrRestBaseline: z.number().int().min(25).max(120).optional(),
    hrThreshold: z.number().int().min(80).max(220).optional(),
    hrThresholdMeasured: z.boolean().optional(),
    vo2max: z.number().min(10).max(95).optional(),
    vo2maxMeasured: z.boolean().optional(),
    ftpWatts: z.number().min(20).max(700).optional(),
    ftpMeasured: z.boolean().optional(),
    vmaKmh: z.number().min(5).max(30).optional(),
    vmaMeasured: z.boolean().optional(),
    oneRmSquatKg: z.number().min(10).max(500).optional(),
    oneRmMeasured: z.boolean().optional(),
    hrvBaselineMs: z.number().min(5).max(250).optional(),

    hrDriftPct: z.number().min(0).max(40).optional(),
    runCadenceSpm: z.number().min(100).max(220).optional(),
    bikeCadenceRpm: z.number().min(30).max(140).optional(),
    intensityFactor: z.number().min(0.3).max(1.8).optional(),
    targetZoneTimePct: z.number().min(0).max(100).optional(),
  })
  .strict();

/* --------------------------------- profile -------------------------------- */

export const ProfileSchema = z
  .object({
    /** Nom affiché dans "Bonjour {name}" */
    name: z.string().trim().min(2).optional(),

    sex: SexSchema.optional(),

    age: z.number().int().min(10).max(99).optional(),
    heightCm: z.number().int().min(120).max(230).optional(),
    weightKg: z.number().int().min(30).max(250).optional(),

    /** Niveau sportif global (peut diverger selon sport plus tard) */
    level: LevelSchema.optional(),

    /** années de pratique sportive */
    yearsPractice: z.number().int().min(0).max(70).optional(),

    /** Multi-sport: au moins 1 sport choisi */
    sports: z.array(SportSchema).min(1).max(6).optional(),

    /** Antécédents blessures */
    injuries: z.array(InjurySchema).max(20).optional(),

    /** disponibilité d'entraînement */
    availability: AvailabilitySchema.optional(),

    /** matériel disponible */
    equipment: z.array(z.string().trim().min(2).max(40)).max(20).optional(),

    /** localisation détectée */
    location: LocationSchema.optional(),

    /** données physiologiques et performance (optionnelles) */
    physiology: PhysiologySchema.optional(),
  })
  .strict()
  .transform((p) => {
    const sportsRaw = Array.isArray(p.sports) ? p.sports : ["Course à pied"];
    const sports = Array.from(new Set(sportsRaw));

    const injuries = Array.isArray(p.injuries)
      ? p.injuries
          .filter((x) => x && typeof x === "object")
          .slice(0, 20)
      : undefined;

    return {
      ...p,
      sports: sports.length ? sports : ["Course à pied"],
      injuries,
    };
  });

export type Profile = z.infer<typeof ProfileSchema>;

/* --------------------------------- program -------------------------------- */

export const ProgramSchema = z
  .object({
    goal: GoalSchema.optional(),
    level: LevelSchema.optional(),

    /** Nb de séances souhaitées/semaine (1..6) */
    sessionsPerWeek: SessionsPerWeekSchema.optional(),

    /** 0=Lun … 6=Dim */
    trainingDays: z.array(DayOfWeekSchema).min(1).max(6).optional(),

    /**
     * Déplacement de séance:
     * - allowMoveSessions = true => le coach peut déplacer une séance
     * - movableDays = jours acceptés pour déplacement (optionnel)
     */
    allowMoveSessions: z.boolean().optional(),
    movableDays: z.array(DayOfWeekSchema).min(1).max(6).optional(),

    /**
     * Séances de calibrage:
     * On ne demande pas à l'utilisateur: on dérive du sessionsPerWeek
     * Règle:
     * - min 3, max 6
     * - donc: clamp(sessionsPerWeek, 3, 6)
     */
    calibrationSessionsCount: z.number().int().min(3).max(6).optional(),
  })
  .strict()
  .transform((p) => {
    const goal = p.goal ?? "10 km";
    const level = p.level ?? "Intermédiaire";
    const sessionsPerWeek = p.sessionsPerWeek ?? 3;

    // trainingDays: défaut (Mar, Jeu, Dim) ajusté au sessionsPerWeek
    const tdBase = Array.isArray(p.trainingDays) ? p.trainingDays : [1, 3, 6];
    const td = uniqSorted(tdBase).slice(0, sessionsPerWeek);
    const trainingDays = td.length ? td : [1];

    const allowMoveSessions = p.allowMoveSessions ?? false;

    const movableBase = Array.isArray(p.movableDays) ? p.movableDays : undefined;
    const movableDays =
      allowMoveSessions && movableBase?.length
        ? uniqSorted(movableBase).slice(0, 6)
        : undefined;

    // calibrage: dérivé (si user a mis une valeur, on la garde mais on la clamp)
    const derivedCal = clampInt(sessionsPerWeek, 3, 6);
    const calibrationSessionsCount =
      typeof p.calibrationSessionsCount === "number"
        ? clampInt(p.calibrationSessionsCount, 3, 6)
        : derivedCal;

    return {
      ...p,
      goal,
      level,
      sessionsPerWeek,
      trainingDays,
      allowMoveSessions,
      movableDays,
      calibrationSessionsCount,
    };
  });

export type Program = z.infer<typeof ProgramSchema>;

/* -------------------------------- onboarding ------------------------------ */

export const OnboardingSchema = z
  .object({
    profile: ProfileSchema.optional(),
    program: ProgramSchema.optional(),

    createdAt: IsoDateString.optional(),
    updatedAt: IsoDateString.optional(),
  })
  .strict()
  .transform((o) => {
    const now = new Date().toISOString();
    return {
      ...o,
      createdAt: o.createdAt ?? now,
      updatedAt: o.updatedAt ?? now,
    };
  });

export type Onboarding = z.infer<typeof OnboardingSchema>;
