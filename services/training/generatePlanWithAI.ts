import { z } from "zod";

import { getApiBaseUrl } from "@/lib/api";
import type { Profile, Program } from "@/storage/onboarding";
import type { Intensity, Session, TrainingPlan, TrainingWeek } from "@/storage/trainingPlan";

const PLAN_GENERATION_SYSTEM = `
Tu es PacePilot, un coach sportif IA expert, bienveillant et ultra-personnalise.
Tu generes des plans d'entrainement structures, semaine par semaine, seance par seance.
Chaque plan est unique et base sur les donnees reelles de l'utilisateur.

SPORTS MAITRISES :
Course a pied (5km, 10km, semi, marathon, trail, ultra)
Cyclisme (route, VTT, indoor, gran fondo)
Natation (piscine, eau libre)
Triathlon (Sprint, Olympique, Half 70.3, Full Ironman)
Musculation / Fitness (masse, force, perte de poids, tonification)

ZONES D'INTENSITE :
Z1 Recuperation    < 60% FCmax  |  < 55% FTP
Z2 Endurance       60-70%       |  56-75%
Z3 Tempo           70-80%       |  76-90%
Z4 Seuil           80-90%       |  91-105%
Z5 VO2max          90-95%       |  106-120%
Z6 Anaerobie       95-100%      |  121-150%
Z7 Sprint max      > 100%       |  > 150%

REGLES ABSOLUES :
- Progression volume max +10%/semaine
- Regle 80/20 : 80% basse intensite (Z1-Z2) / 20% haute (Z4-Z5)
- Semaine de recuperation obligatoire toutes les 3-4 semaines (-35% volume)
- Jamais 2 seances dures consecutives
- Tapering avant competition : -40% volume sur 2-3 semaines
- Adapter selon blessures, fatigue, disponibilite

REPONDS UNIQUEMENT EN JSON VALIDE selon ce schema exact :
{
  "plan": {
    "sport": "string",
    "objectif": "string",
    "duree_semaines": number,
    "semaines": [{
      "numero": number,
      "theme": "string",
      "volume_total": "string",
      "seances": [{
        "jour": "string",
        "type": "string",
        "zone": "string",
        "duree": "string",
        "echauffement": "string",
        "corps": [{
          "exercice": "string",
          "series": number,
          "reps_ou_duree": "string",
          "intensite": "string",
          "repos": "string",
          "notes": "string"
        }],
        "retour_au_calme": "string",
        "objectif_seance": "string",
        "indicateur_reussite": "string"
      }],
      "conseils_semaine": "string",
      "note_recuperation": "string"
    }]
  }
}
Ne retourne rien d'autre que le JSON. Pas de texte avant, pas de texte apres.
`;

function buildPlanUserMessage(profile: Profile, program: Program): string {
  const profileForPrompt = {
    ...profile,
    objectif: program.goal ?? "10 km",
    niveau: program.level ?? profile.level ?? "Intermediaire",
    sessions_par_semaine: program.sessionsPerWeek ?? 3,
    jours_entrainement: Array.isArray(program.trainingDays) ? program.trainingDays : [1, 3, 6],
  };

  const maybeWeeks = Number((profile as any)?.duree_semaines);
  const dureeSemaines = Number.isFinite(maybeWeeks) && maybeWeeks > 0 ? Math.trunc(maybeWeeks) : 8;

  return `
Genere un plan d'entrainement complet pour ce profil :
${JSON.stringify(profileForPrompt, null, 2)}

Genere les ${dureeSemaines} premieres semaines.
  `.trim();
}

const AIPlanExerciseSchema = z.object({
  exercice: z.string().min(1),
  series: z.number().int().min(1).optional(),
  reps_ou_duree: z.string().optional(),
  intensite: z.string().optional(),
  repos: z.string().optional(),
  notes: z.string().optional(),
});

const AIPlanSessionSchema = z.object({
  jour: z.string().min(1),
  type: z.string().min(1),
  zone: z.string().min(1),
  duree: z.string().min(1),
  echauffement: z.string().optional(),
  corps: z.array(AIPlanExerciseSchema).default([]),
  retour_au_calme: z.string().optional(),
  objectif_seance: z.string().optional(),
  indicateur_reussite: z.string().optional(),
});

const AIPlanWeekSchema = z.object({
  numero: z.number().int().min(1),
  theme: z.string().min(1),
  volume_total: z.string().min(1),
  seances: z.array(AIPlanSessionSchema).min(1),
  conseils_semaine: z.string().optional(),
  note_recuperation: z.string().optional(),
});

const AIPlanPayloadSchema = z.object({
  plan: z.object({
    sport: z.string().min(1),
    objectif: z.string().min(1),
    duree_semaines: z.number().int().min(1),
    semaines: z.array(AIPlanWeekSchema).min(1),
  }),
});

type AIPlanRequest = {
  system: string;
  userMessage: string;
  maxTokens?: number;
};

type AIPlanResponse = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

type GeneratePlanWithAIOptions = {
  backendUrl?: string;
  timeoutMs?: number;
};

function normalizeBaseUrl(value?: string): string {
  const raw = String(value ?? getApiBaseUrl()).trim();
  if (!raw) return getApiBaseUrl();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function mapDayOfWeek(value: string): number {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("lun")) return 0;
  if (normalized.startsWith("mar")) return 1;
  if (normalized.startsWith("mer")) return 2;
  if (normalized.startsWith("jeu")) return 3;
  if (normalized.startsWith("ven")) return 4;
  if (normalized.startsWith("sam")) return 5;
  if (normalized.startsWith("dim")) return 6;
  return 0;
}

function mapIntensity(type: string, zone: string): Intensity {
  const t = type.toLowerCase();
  const z = zone.toLowerCase();

  if (t.includes("longue") || t.includes("sortie longue")) return "LONG";
  if (z.includes("z5") || z.includes("z6") || z.includes("z7")) return "INTERVAL";
  if (z.includes("z4") || t.includes("seuil")) return "THRESHOLD";
  if (z.includes("z3") || t.includes("tempo")) return "TEMPO";
  if (z.includes("z1") || t.includes("recup")) return "RECOVERY";
  return "EASY";
}

function estimateDistanceKm(durationLabel: string, intensity: Intensity): number {
  const txt = durationLabel.toLowerCase();

  const hourMinuteMatch = txt.match(/(\d+)h(?:(\d{1,2}))?/);
  if (hourMinuteMatch) {
    const hours = Number(hourMinuteMatch[1] ?? 0);
    const minutes = Number(hourMinuteMatch[2] ?? 0);
    const totalMinutes = hours * 60 + minutes;
    const pace = intensity === "LONG" ? 6.5 : 6.0;
    return Math.max(3, Math.round(totalMinutes / pace));
  }

  const minutesMatch = txt.match(/(\d+)\s*min/);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1] ?? 0);
    const pace = intensity === "INTERVAL" ? 5.5 : 6.0;
    return Math.max(2, Math.round(minutes / pace));
  }

  return intensity === "LONG" ? 12 : 6;
}

function parseVolumeTotalKm(label: string): number | null {
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*km/i);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null;
}

function mapFocus(theme: string): TrainingWeek["focus"] {
  const t = theme.toLowerCase();
  if (t.includes("affut") || t.includes("taper") || t.includes("competition")) return "Taper";
  if (t.includes("spec") || t.includes("build") || t.includes("construction")) return "Spécifique";
  return "Base";
}

function toTrainingPlan(
  payload: z.infer<typeof AIPlanPayloadSchema>,
  profile: Profile,
  program: Program
): TrainingPlan {
  const weeks: TrainingWeek[] = payload.plan.semaines
    .map((week) => {
      const sessions: Session[] = week.seances.map((session) => {
        const intensity = mapIntensity(session.type, session.zone);
        const distanceKm = estimateDistanceKm(session.duree, intensity);

        const notes = [
          session.objectif_seance ? `Objectif: ${session.objectif_seance}` : null,
          session.indicateur_reussite ? `Reussite: ${session.indicateur_reussite}` : null,
        ]
          .filter(Boolean)
          .join(" | ");

        return {
          dayOfWeek: mapDayOfWeek(session.jour),
          label: session.type,
          intensity,
          distanceKm,
          notes: notes || undefined,
        };
      });

      const computedTotal = sessions.reduce((sum, s) => sum + (s.distanceKm ?? 0), 0);
      const totalKm = parseVolumeTotalKm(week.volume_total) ?? computedTotal;

      return {
        weekIndex: week.numero,
        focus: mapFocus(week.theme),
        totalKm,
        sessions,
      };
    })
    .sort((a, b) => a.weekIndex - b.weekIndex);

  const goal = payload.plan.objectif || program.goal || "Objectif en cours";
  const level = program.level || profile.level || "Intermédiaire";

  return {
    planId: `ai_plan_${Date.now()}`,
    goal,
    level,
    createdAt: new Date().toISOString(),
    version: 4,
    weeks,
  };
}

export async function generatePlanWithAI(
  profile: Profile,
  program: Program,
  options?: GeneratePlanWithAIOptions
): Promise<TrainingPlan> {
  const backendBase = normalizeBaseUrl(options?.backendUrl);
  const timeoutMs = Math.max(8000, Math.min(45000, Math.trunc(options?.timeoutMs ?? 30000)));

  const req: AIPlanRequest = {
    system: PLAN_GENERATION_SYSTEM,
    userMessage: buildPlanUserMessage(profile, program),
    maxTokens: 4000,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${backendBase}/ai/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    const json = (await response.json().catch(() => null)) as AIPlanResponse | null;

    if (!response.ok) {
      const reason = json?.error ?? `Erreur backend (${response.status})`;
      throw new Error(reason);
    }

    if (!json?.ok || !json.data) {
      throw new Error(json?.error ?? "Reponse IA invalide");
    }

    const parsed = AIPlanPayloadSchema.safeParse(json.data);
    if (!parsed.success) {
      throw new Error("Le JSON renvoye par l'IA ne respecte pas le schema attendu");
    }

    return toTrainingPlan(parsed.data, profile, program);
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Timeout de generation du plan IA");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
