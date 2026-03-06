// lib/syncPlan.ts
import { getSupabaseClient } from "@/lib/supabase";
import type { TrainingPlan } from "@/storage/trainingPlan";
import type { WeeklyPlan } from "@/storage/weeklyPlan";

/**
 * Sauvegarde le plan hebdomadaire dans Supabase.
 * Ne bloque jamais l'app si ça échoue (offline, etc.)
 */
export async function syncWeeklyPlanToSupabase(plan: WeeklyPlan): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // pas encore connecté → skip silencieux

    await supabase.from("plans").upsert({
      user_id: user.id,
      sport: "course_a_pied",
      objectif: (plan as any).goal ?? "général",
      statut: "actif",
      semaines: plan as any,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id", // un seul plan actif par user
    });
  } catch (e) {
    console.warn("[syncWeeklyPlanToSupabase] skip:", e);
  }
}

/**
 * Sauvegarde le plan complet (N semaines) dans Supabase.
 */
export async function syncTrainingPlanToSupabase(plan: TrainingPlan): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("plans").upsert({
      user_id: user.id,
      sport: "course_a_pied",
      objectif: plan.goal ?? "général",
      duree_semaines: plan.weeks?.length ?? 0,
      statut: "actif",
      semaines: plan as any,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "user_id",
    });
  } catch (e) {
    console.warn("[syncTrainingPlanToSupabase] skip:", e);
  }
}