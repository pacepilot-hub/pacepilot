import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import * as onboarding from "@/storage/onboarding";
import { ensureWeeklyPlan } from "@/coaching/planService";
import type { WeeklyPlan } from "@/storage/weeklyPlan";

/* -------------------------------- helpers -------------------------------- */

const DOW_FULL = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

type HealthTone = "green" | "orange" | "slate";

function todayIndexMon0(d: Date) {
  const js = d.getDay(); // 0=dim..6=sam
  return js === 0 ? 6 : js - 1; // 0=lun..6=dim
}

function dayLabelFr(d: Date): string {
  const idx = todayIndexMon0(d);
  return DOW_FULL[idx] ?? "Aujourd’hui";
}

function safeFirstName(ob: any): string {
  const raw =
    ob?.profile?.firstName ??
    ob?.profile?.name ??
    ob?.user?.firstName ??
    ob?.user?.name ??
    ob?.name ??
    "Athlète";

  const s = String(raw ?? "").trim();
  if (!s) return "Athlète";

  const first = s.split(/\s+/)[0]?.trim();
  return first || "Athlète";
}

function healthFromWorkout(workout?: string): { text: string; tone: HealthTone } {
  const t = String(workout ?? "").toLowerCase().trim();
  if (!t) return { text: "—", tone: "slate" };

  // repos / récup
  if (t.includes("repos") || t.includes("recup") || t.includes("récup")) {
    return { text: "Récupération optimale", tone: "slate" };
  }

  // très exigeant / sortie longue
  if (t.includes("sortie longue") || t.includes("long") || t.includes("cl")) {
    return { text: "Charge élevée • reste prudent", tone: "orange" };
  }

  // séances clés
  if (t.includes("fraction") || t.includes("interv") || t.includes("seuil") || t.includes("tempo") || t.includes("vma")) {
    return { text: "Séance clé • focus qualité", tone: "orange" };
  }

  // endurance / footing
  if (t.includes("ef") || t.includes("footing") || t.includes("endurance")) {
    return { text: "Charge maîtrisée • progression continue", tone: "green" };
  }

  return { text: "Charge maîtrisée • progression continue", tone: "green" };
}

function buildSubline(d: Date, workout?: string) {
  const { text } = healthFromWorkout(workout);
  return `${dayLabelFr(d)} • ${text}`;
}

function getTodayWorkout(plan: WeeklyPlan | null | undefined, d: Date): string | undefined {
  const idx = todayIndexMon0(d);
  const w = plan?.days?.[idx]?.workout;
  return typeof w === "string" && w.trim().length ? w : undefined;
}

/** Millisecondes jusqu’au prochain minuit local + un petit buffer */
function msUntilNextLocalMidnight(now: Date) {
  const n = new Date(now);
  const next = new Date(n);
  next.setHours(24, 0, 5, 0); // 00:00:05 pour éviter edge cases
  return Math.max(5_000, next.getTime() - n.getTime());
}

/* ---------------------------------- hook --------------------------------- */

export type TodayHeaderState = {
  firstName: string;
  subline: string;
  tone: HealthTone;
  workout?: string;
  isLoading: boolean;
  error?: string;
  refresh: () => Promise<void>;
};

/**
 * useTodayHeader
 * - charge onboarding + weekly plan
 * - produit un header stable: prénom + "Jour • statut"
 * - garde-fous: pas de setState après unmount, pas de race condition (refresh le plus récent gagne)
 * - mise à jour après minuit local (1 timer, pas un interval permanent)
 * - option: refresh au retour foreground
 */
export function useTodayHeader(): TodayHeaderState {
  const [now, setNow] = useState<Date>(() => new Date());

  const [firstName, setFirstName] = useState<string>("Athlète");
  const [workout, setWorkout] = useState<string | undefined>(undefined);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | undefined>(undefined);

  const aliveRef = useRef(true);
  const refreshSeqRef = useRef(0);

  const tone = useMemo(() => healthFromWorkout(workout).tone, [workout]);
  const subline = useMemo(() => buildSubline(now, workout), [now, workout]);

  const refresh = useCallback(async () => {
    const seq = ++refreshSeqRef.current;

    setIsLoading(true);
    setError(undefined);

    try {
      const [o, p] = await Promise.all([
        onboarding.loadOnboarding().catch(() => null),
        ensureWeeklyPlan().catch(() => null),
      ]);

      if (!aliveRef.current || seq !== refreshSeqRef.current) return;

      const name = safeFirstName(o);
      const w = getTodayWorkout(p as WeeklyPlan | null, new Date());

      setFirstName(name);
      setWorkout(w);
    } catch {
      if (!aliveRef.current || seq !== refreshSeqRef.current) return;
      setError("Impossible de charger les données du jour.");
    } finally {
      if (!aliveRef.current || seq !== refreshSeqRef.current) return;
      setIsLoading(false);
    }
  }, []);

  /* 1) initial load */
  useEffect(() => {
    aliveRef.current = true;
    refresh().catch(() => {});
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  /* 2) update "now" at next local midnight (cheap) */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (!aliveRef.current) return;
      const delay = msUntilNextLocalMidnight(new Date());
      t = setTimeout(() => {
        setNow(new Date());
        schedule(); // re-planifie le prochain minuit
      }, delay);
    }

    schedule();
    return () => {
      if (t) clearTimeout(t);
    };
  }, []);

  /* 3) optional: refresh when app comes back to foreground */
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") {
        setNow(new Date());
        refresh().catch(() => {});
      }
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refresh]);

  return { firstName, subline, tone, workout, isLoading, error, refresh };
}
