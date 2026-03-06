import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { Card, Screen, ButtonPrimary } from "@/components/ui";
import PacepilotMark from "@/components/PacepilotMark";
import { theme } from "@/constants/theme";

import type { Goal, Level, Program, SessionsPerWeek, Sport } from "@/storage/onboarding";
import { loadOnboarding, saveOnboarding } from "@/storage/onboarding";

import { generatePlan } from "@/services/training/generatePlan";
import { generatePlanWithAI } from "@/services/training/generatePlanWithAI";
import { saveTrainingPlan } from "@/storage/trainingPlan";

const DOW = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function uniqDays(days: number[]) {
  return Array.from(new Set(days))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b)
    .slice(0, 6);
}

function mapSportToGoal(sport: Sport): Goal {
  if (sport === "Trail") return "Trail (objectif)";
  if (sport === "Course à pied") return "10 km";
  return "Forme";
}

function toSessionsPerWeek(days: number[]): SessionsPerWeek {
  const n = Math.max(1, Math.min(6, uniqDays(days).length || 3));
  return n as SessionsPerWeek;
}

function calibrationSessionsCountFrom(sessionsPerWeek: SessionsPerWeek): number {
  return Math.max(3, Math.min(6, Number(sessionsPerWeek)));
}

function buildProgramFromProfile(profile: any): Program {
  const primarySport = (Array.isArray(profile?.sports) && profile.sports[0]) || "Course à pied";
  const safeDays = uniqDays(profile?.availability?.trainingDays ?? [1, 3, 6]);
  const sessionsPerWeek = toSessionsPerWeek(safeDays);

  const level =
    profile?.level === "Débutant" ||
    profile?.level === "Intermédiaire" ||
    profile?.level === "Avancé" ||
    profile?.level === "Élite"
      ? (profile.level as Level)
      : "Intermédiaire";

  return {
    goal: mapSportToGoal(primarySport as Sport),
    level,
    sessionsPerWeek,
    trainingDays: safeDays,
    allowMoveSessions: false,
    movableDays: [],
    calibrationSessionsCount: calibrationSessionsCountFrom(sessionsPerWeek),
  };
}

export default memo(function ProgramSetup() {
  const router = useRouter();

  const aliveRef = useRef(true);
  const savingRef = useRef(false);
  const spin = useRef(new Animated.Value(0)).current;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [generationMsg, setGenerationMsg] = useState<string | null>(null);

  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    aliveRef.current = true;

    (async () => {
      try {
        const data = await loadOnboarding().catch(() => null);
        if (!aliveRef.current) return;
        setProfile(data?.profile ?? null);
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    })();

    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!saving) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [saving, spin]);

  const summary = useMemo(() => {
    const p = profile ?? {};
    const sport = Array.isArray(p?.sports) && p.sports[0] ? p.sports[0] : "Course à pied";
    const level = p?.level ?? "Intermédiaire";
    const days = uniqDays(p?.availability?.trainingDays ?? [1, 3, 6]).map((d) => DOW[d]).join(" • ");
    const duration = Number(p?.availability?.sessionDurationMin) || 60;

    return `${sport} • ${level} • ${days} • ${duration} min/séance`;
  }, [profile]);

  const onContinue = useCallback(async () => {
    if (savingRef.current || loading) return;

    savingRef.current = true;
    setSaving(true);
    setErrMsg(null);
    setGenerationMsg(null);

    try {
      const data = await loadOnboarding().catch(() => null);
      const profilePayload = (data?.profile ?? profile ?? {}) as any;

      const programPayload = buildProgramFromProfile(profilePayload);

      await saveOnboarding({
        program: programPayload,
      });

      let plan = null as Awaited<ReturnType<typeof generatePlanWithAI>> | null;

      try {
        setGenerationMsg("Génération IA en cours…");
        plan = await generatePlanWithAI(profilePayload, programPayload);
      } catch (aiError: any) {
        console.log("ai plan generation error:", String(aiError?.message ?? aiError ?? "unknown"));
        setGenerationMsg("IA indisponible, fallback local…");
        plan = generatePlan(profilePayload, programPayload);
      }

      await saveTrainingPlan(plan);
      router.replace("/onboarding/done");
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Erreur inconnue");
      console.log("program onboarding error:", msg);
      setErrMsg("On n'a pas pu finaliser le programme. Réessaie.");
    } finally {
      if (!aliveRef.current) return;
      setSaving(false);
      setGenerationMsg(null);
      savingRef.current = false;
    }
  }, [loading, profile, router]);

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
        <Text style={s.h1}>Ton plan est prêt à être généré</Text>
        <Text style={s.p}>Tu as configuré ton avatar sportif. On lance la génération IA.</Text>

        <Card style={{ marginTop: 14 }}>
          <Text style={s.summary}>{summary}</Text>

          {!!errMsg && <Text style={s.err}>{errMsg}</Text>}
          {!!generationMsg && <Text style={s.hint}>{generationMsg}</Text>}

          <View style={{ marginTop: 14, opacity: saving ? 0.7 : 1 }}>
            <ButtonPrimary label={saving ? "Génération…" : "Générer mon plan"} onPress={onContinue} disabled={saving} />
          </View>

          <Pressable
            onPress={() => router.replace("/onboarding/profile")}
            style={({ pressed }) => [{ marginTop: 10 }, pressed && { opacity: 0.86 }]}
            disabled={saving}
          >
            <Text style={s.link}>Retour avatar</Text>
          </Pressable>

          {saving ? (
            <View style={s.overlay}>
              <Animated.View
                style={{
                  transform: [
                    {
                      rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }),
                    },
                  ],
                }}
              >
                <PacepilotMark width={120} />
              </Animated.View>
              <Text style={s.overlayText}>{generationMsg ?? "Génération du plan..."}</Text>
            </View>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
});

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

  hint: { marginTop: 6, color: theme.colors.text2, fontWeight: "700" },
  err: { marginTop: 10, color: theme.colors.primary, fontWeight: "900" },
  link: { color: theme.colors.primary, fontWeight: "900" },

  overlay: {
    position: "absolute",
    left: 10,
    right: 10,
    top: 10,
    bottom: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(11,11,12,0.92)",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  overlayText: { color: theme.colors.text, fontWeight: "900" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingTxt: { color: theme.colors.text2, fontWeight: "800" },
});
