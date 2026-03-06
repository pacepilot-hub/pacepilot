import AsyncStorage from "@react-native-async-storage/async-storage";

import { getSupabaseConfig } from "@/lib/api";
import { getSupabaseAccessToken, getSupabaseUserId } from "@/lib/supabase";
import type { TrainingPlan } from "@/storage/trainingPlan";

const SUPABASE_PLAN_ID_KEY = "pacepilot:trainingPlan:supabaseId:v1";

type SupabasePlanRow = {
  id: string;
  user_id: string;
  sport: string;
  statut: string;
  date_debut: string;
  date_fin: string;
  semaines: unknown;
};

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDaysYmd(startYmd: string, delta: number): string {
  const [y, m, d] = startYmd.split("-").map((x) => Number(x));
  const date = new Date(y || 1970, (m || 1) - 1, d || 1);
  date.setDate(date.getDate() + delta);
  return toYmd(date);
}

function inferSport(goal: string): string {
  const g = String(goal ?? "").toLowerCase();
  if (g.includes("velo") || g.includes("cycl")) return "cyclisme";
  if (g.includes("natation") || g.includes("swim")) return "natation";
  if (g.includes("triathlon")) return "triathlon";
  if (g.includes("musculation") || g.includes("fitness")) return "musculation";
  return "course";
}

function parseSemaines(semaines: unknown): TrainingPlan["weeks"] | null {
  if (!Array.isArray(semaines) || semaines.length === 0) return null;
  return semaines as TrainingPlan["weeks"];
}

async function getRemotePlanId(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(SUPABASE_PLAN_ID_KEY);
    const s = String(v ?? "").trim();
    return s.length ? s : null;
  } catch {
    return null;
  }
}

async function saveRemotePlanId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(SUPABASE_PLAN_ID_KEY, id);
  } catch {
    // noop
  }
}

function randomHex(size: number): string {
  let out = "";
  while (out.length < size) out += Math.floor(Math.random() * 16).toString(16);
  return out.slice(0, size);
}

function createUuid(): string {
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-a${randomHex(3)}-${randomHex(12)}`;
}

export async function saveTrainingPlanToSupabase(plan: TrainingPlan): Promise<void> {
  const supabase = getSupabaseConfig();
  if (!supabase) return;

  const [userId, accessToken] = await Promise.all([
    getSupabaseUserId(),
    getSupabaseAccessToken(),
  ]);
  if (!userId || !accessToken) return;

  const id = (await getRemotePlanId()) ?? createUuid();
  const start = toYmd(new Date(plan.createdAt || Date.now()));
  const end = addDaysYmd(start, Math.max(1, plan.weeks.length) * 7);

  const payload: SupabasePlanRow = {
    id,
    user_id: userId,
    sport: inferSport(plan.goal),
    statut: "active",
    date_debut: start,
    date_fin: end,
    semaines: plan.weeks,
  };

  const res = await fetch(`${supabase.url}/rest/v1/plans?on_conflict=id`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabase.anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([payload]),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Supabase save failed (${res.status}): ${msg}`);
  }

  await saveRemotePlanId(id);
}

export async function pullLatestTrainingPlanFromSupabase(): Promise<TrainingPlan | null> {
  const supabase = getSupabaseConfig();
  if (!supabase) return null;

  const [userId, accessToken] = await Promise.all([
    getSupabaseUserId(),
    getSupabaseAccessToken(),
  ]);
  if (!userId || !accessToken) return null;

  const query = new URLSearchParams({
    select: "id,user_id,sport,statut,date_debut,date_fin,semaines",
    user_id: `eq.${userId}`,
    order: "date_debut.desc",
    limit: "1",
  });

  const res = await fetch(`${supabase.url}/rest/v1/plans?${query.toString()}`, {
    method: "GET",
    headers: {
      apikey: supabase.anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) return null;

  const rows = (await res.json().catch(() => null)) as SupabasePlanRow[] | null;
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return null;

  const weeks = parseSemaines(row.semaines);
  if (!weeks) return null;

  await saveRemotePlanId(row.id);

  return {
    planId: row.id,
    goal: "Plan synchronise",
    level: "Intermédiaire",
    weeks,
    createdAt: new Date().toISOString(),
    version: 4,
  };
}
