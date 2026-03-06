// app/onboarding/program.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Card, Screen, SectionTitle, ButtonPrimary } from "@/components/ui";
import { theme } from "@/constants/theme";

import type { Goal, Level, SessionsPerWeek } from "@/storage/onboarding";
import { loadOnboarding, saveOnboarding } from "@/storage/onboarding";

import { generatePlan } from "@/services/training/generatePlan";
import { saveTrainingPlan } from "@/storage/trainingPlan";

/* -------------------------------- constants ------------------------------ */

const LEVELS: Level[] = ["Débutant", "Intermédiaire", "Avancé"];
const GOALS: Goal[] = ["Forme", "Perte de poids", "5 km", "10 km", "Semi-marathon", "Marathon"];
const SESSIONS: SessionsPerWeek[] = [ 1, 2, 3, 4, 5, 6];

const DOW = [
  { idx: 0, label: "Lun" },
  { idx: 1, label: "Mar" },
  { idx: 2, label: "Mer" },
  { idx: 3, label: "Jeu" },
  { idx: 4, label: "Ven" },
  { idx: 5, label: "Sam" },
  { idx: 6, label: "Dim" },
] as const;

const DEFAULT_DAY = 1; // Mar

/* -------------------------------- helpers -------------------------------- */

function uniqSortedDays(days: number[]) {
  return Array.from(new Set(days))
    .filter((d) => Number.isFinite(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
}

/**
 * Garantit:
 * - jours uniques (0..6) triés
 * - longueur exactement = targetCount
 * - conserve au max les jours existants, puis complète avec un ordre “naturel”
 */
function ensureDaysCount(days: number[], targetCount: number) {
  let next = uniqSortedDays(days).slice(0, targetCount);

  if (next.length === 0) next = [DEFAULT_DAY];

  if (next.length < targetCount) {
    const set = new Set(next);
    for (const d of [DEFAULT_DAY, 3, 5, 0, 2, 4, 6]) {
      if (set.size >= targetCount) break;
      set.add(d);
    }
    next = uniqSortedDays(Array.from(set)).slice(0, targetCount);
  }

  return next;
}

function daysLabel(days: number[], count: number) {
  return ensureDaysCount(days, count)
    .slice(0, count)
    .map((d) => DOW.find((x) => x.idx === d)?.label ?? "?")
    .join(" • ");
}

/* ----------------------------- small UI pieces ---------------------------- */

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      style={({ pressed }) => [s.chip, active && s.chipOn, pressed && { opacity: 0.86 }]}
    >
      <Text style={[s.chipTxt, active && s.chipTxtOn]}>{label}</Text>
    </Pressable>
  );
}

function DayPill({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      disabled={disabled}
      style={({ pressed }) => [
        s.day,
        active && s.dayOn,
        disabled && { opacity: 0.55 },
        pressed && !disabled && { opacity: 0.86 },
      ]}
    >
      <Text style={[s.dayTxt, active && s.dayTxtOn]}>{label}</Text>
    </Pressable>
  );
}

/* -------------------------------- component ------------------------------ */

export default memo(function ProgramSetup() {
  const router = useRouter();

  const aliveRef = useRef(true);
  const savingRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [loading, setLoading] = useState(true);

  const [level, setLevel] = useState<Level>("Intermédiaire");
  const [goal, setGoal] = useState<Goal>("10 km");
  const [sessionsPerWeek, setSessionsPerWeek] = useState<SessionsPerWeek>(3);
  const [trainingDays, setTrainingDays] = useState<number[]>([1, 3, 6]); // Mar/Jeu/Dim

  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  /* -------------------------- hydrate from storage ------------------------- */

  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      try {
        const data = await loadOnboarding().catch(() => null);
        if (!aliveRef.current) return;

        const p: any = data?.program ?? {};

        if (p?.goal) setGoal(p.goal);
        if (p?.level) setLevel(p.level);
        if (p?.sessionsPerWeek) setSessionsPerWeek(p.sessionsPerWeek);

        const days = Array.isArray(p?.trainingDays) ? uniqSortedDays(p.trainingDays) : null;
        if (days?.length) setTrainingDays(days);
      } finally {
        if (!aliveRef.current) return;
        setLoading(false);
      }
    })();

    return () => {
      aliveRef.current = false;
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    };
  }, []);

  /* ----------------------------- coherence rules --------------------------- */

  // Quand sessions change, on ajuste automatiquement la liste des jours.
  useEffect(() => {
    setTrainingDays((prev) => ensureDaysCount(prev, sessionsPerWeek));
  }, [sessionsPerWeek]);

  /* --------------------------- autosave (draft) ---------------------------- */

  const scheduleDraftSave = useCallback(
    (next: { goal?: Goal; level?: Level; sessionsPerWeek?: SessionsPerWeek; trainingDays?: number[] }) => {
      if (loading) return;

      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);

      draftTimerRef.current = setTimeout(() => {
        saveOnboarding({
          program: {
            goal: next.goal ?? goal,
            level: next.level ?? level,
            sessionsPerWeek: next.sessionsPerWeek ?? sessionsPerWeek,
            trainingDays: ensureDaysCount(next.trainingDays ?? trainingDays, next.sessionsPerWeek ?? sessionsPerWeek),
          },
        }).catch(() => {});
      }, 300);
    },
    [loading, goal, level, sessionsPerWeek, trainingDays]
  );

  /* ----------------------------- derived texts ----------------------------- */

  const safeDays = useMemo(
    () => ensureDaysCount(trainingDays, sessionsPerWeek),
    [trainingDays, sessionsPerWeek]
  );

  const hintText = useMemo(
    () => `Choisis ${sessionsPerWeek} jour(s) d’entraînement.`,
    [sessionsPerWeek]
  );

  const summaryText = useMemo(() => {
    return `${goal} • ${level} • ${sessionsPerWeek}/sem • ${daysLabel(safeDays, sessionsPerWeek)}`;
  }, [goal, level, sessionsPerWeek, safeDays]);

  /* ----------------------------- interactions ------------------------------ */

  const toggleDay = useCallback(
    (idx: number) => {
      setErrMsg(null);

      setTrainingDays((prev) => {
        const set = new Set(prev);
        const isOn = set.has(idx);

        // Si l'utilisateur enlève un jour et que ça ferait < sessionsPerWeek,
        // on autorise quand même (et on auto-complète). C’est plus “fluide”.
        if (isOn) set.delete(idx);
        else set.add(idx);

        const next = ensureDaysCount(Array.from(set), sessionsPerWeek);
        scheduleDraftSave({ trainingDays: next });
        return next;
      });
    },
    [sessionsPerWeek, scheduleDraftSave]
  );

  const onPickGoal = useCallback(
    (g: Goal) => {
      setErrMsg(null);
      setGoal(g);
      scheduleDraftSave({ goal: g });
    },
    [scheduleDraftSave]
  );

  const onPickLevel = useCallback(
    (l: Level) => {
      setErrMsg(null);
      setLevel(l);
      scheduleDraftSave({ level: l });
    },
    [scheduleDraftSave]
  );

  const onPickSessions = useCallback(
    (n: SessionsPerWeek) => {
      setErrMsg(null);
      setSessionsPerWeek(n);

      // trainingDays va être recalculé par useEffect, mais on “pré-sauve” aussi
      // pour éviter d’avoir un état transitoire incohérent.
      const nextDays = ensureDaysCount(trainingDays, n);
      setTrainingDays(nextDays);
      scheduleDraftSave({ sessionsPerWeek: n, trainingDays: nextDays });
    },
    [scheduleDraftSave, trainingDays]
  );

  /* -------------------------------- actions ------------------------------- */

  const onContinue = useCallback(async () => {
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setErrMsg(null);

    try {
      // flush draft timer
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;

      const normalizedDays = ensureDaysCount(trainingDays, sessionsPerWeek);

      // 1) sauver program
      await saveOnboarding({
        program: {
          goal,
          level,
          sessionsPerWeek,
          trainingDays: normalizedDays,
        },
      });

      // 2) recharger onboarding (profil partiel ok)
      const data = await loadOnboarding().catch(() => null);

      // 3) générer plan
      const plan = generatePlan((data?.profile ?? {}) as any, {
        goal,
        level,
        sessionsPerWeek,
        trainingDays: normalizedDays,
      } as any);

      // 4) sauver plan
      await saveTrainingPlan(plan);

      // 5) fin onboarding
      router.replace("/onboarding/done");
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Erreur inconnue");
      console.log("program onboarding error:", msg);
      setErrMsg("On n’a pas pu finaliser le programme. Réessaie.");
    } finally {
      if (!aliveRef.current) return;
      setSaving(false);
      savingRef.current = false;
    }
  }, [goal, level, sessionsPerWeek, trainingDays, router]);

  /* ---------------------------------- UI ---------------------------------- */

  if (loading) {
    return (
      <Screen>
        <View style={s.loadingWrap}>
          <ActivityIndicator />
          <Text style={s.loadingTxt}>Chargement…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={s.wrap}>
        <Text style={s.h1}>Ton programme</Text>
        <Text style={s.p}>On construit un plan simple, clair et cohérent.</Text>

        <Card style={{ marginTop: 14 }}>
          <Text style={s.summary}>{summaryText}</Text>

          <SectionTitle>Niveau</SectionTitle>
          <View style={s.chips}>
            {LEVELS.map((x) => (
              <Chip key={x} label={x} active={x === level} onPress={() => onPickLevel(x)} />
            ))}
          </View>

          <SectionTitle>Objectif</SectionTitle>
          <View style={s.chips}>
            {GOALS.map((x) => (
              <Chip key={x} label={x} active={x === goal} onPress={() => onPickGoal(x)} />
            ))}
          </View>

          <SectionTitle>Séances par semaine</SectionTitle>
          <View style={s.chips}>
            {SESSIONS.map((x) => (
              <Chip key={x} label={`${x}`} active={x === sessionsPerWeek} onPress={() => onPickSessions(x)} />
            ))}
          </View>

          <SectionTitle>Jours d’entraînement</SectionTitle>
          <Text style={s.hint}>{hintText}</Text>

          <View style={s.days}>
            {DOW.map((d) => (
              <DayPill
                key={d.idx}
                label={d.label}
                active={safeDays.includes(d.idx)}
                onPress={() => toggleDay(d.idx)}
                disabled={saving}
              />
            ))}
          </View>

          {!!errMsg && <Text style={s.err}>{errMsg}</Text>}

          <View style={{ marginTop: 14, opacity: saving ? 0.7 : 1 }}>
            <ButtonPrimary
              label={saving ? "Enregistrement…" : "Terminer"}
              onPress={onContinue}
              disabled={saving}
            />
          </View>

          <Pressable
            onPress={() => router.replace("/onboarding/profile")}
            style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.86 }]}
            hitSlop={12}
            disabled={saving}
          >
            <Text style={s.link}>Retour</Text>
          </Pressable>
        </Card>
      </View>
    </Screen>
  );
});

/* --------------------------------- styles -------------------------------- */

const s = StyleSheet.create({
  wrap: { padding: 16, paddingTop: 24 },

  h1: { fontSize: 26, fontWeight: "900", color: theme.colors.text },
  p: { marginTop: 6, fontSize: 14, fontWeight: "700", color: theme.colors.text2 },

  summary: {
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontWeight: "900",
  },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: "rgba(239,59,0,0.14)", borderColor: "rgba(239,59,0,0.35)" },
  chipTxt: { color: theme.colors.text, fontWeight: "900" },
  chipTxtOn: { color: theme.colors.primary },

  hint: { marginTop: 6, color: theme.colors.text2, fontWeight: "700" },

  // plus robuste qu'un justifyContent: space-between (wrap / petits écrans)
  days: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  day: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dayOn: { backgroundColor: theme.colors.primary, borderColor: "rgba(255,255,255,0.18)" },
  dayTxt: { color: theme.colors.text2, fontWeight: "900" },
  dayTxtOn: { color: "#fff" },

  err: { marginTop: 10, color: theme.colors.primary, fontWeight: "900" },
  link: { color: theme.colors.primary, fontWeight: "900" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: theme.colors.text2, fontWeight: "800" },
});
