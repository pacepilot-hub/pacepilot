// app/(stack)/plan-setup.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View, Pressable, StyleSheet, TextInput, Platform } from "react-native";
import { useRouter } from "expo-router";

import { Screen, Card, SectionTitle, ButtonPrimary } from "@/components/ui";
import { theme } from "@/constants/theme";
import * as onboarding from "@/storage/onboarding";

/* --------------------------------- types --------------------------------- */

type Discipline = "road" | "trail";
type GoalKind =
  | "weight_loss"
  | "fitness"
  | "finish_distance" // ex: "faire un 10k" sans chrono
  | "time_goal"; // ex: "faire un 10k en X"

type TrailProfile = "flat" | "rolling" | "mountain";

type PlanSetup = {
  discipline: Discipline;
  goalKind: GoalKind;
  distanceKm?: number;
  targetTimeSec?: number | null;
  eventDateISO?: string | null; // YYYY-MM-DD
  trailProfile?: TrailProfile | null;
  done: boolean;
};

/* -------------------------------- helpers -------------------------------- */

function safeStr(x: any) {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

function toInt(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// "HH:MM:SS" ou "MM:SS" -> seconds
function parseTimeToSec(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  const parts = s.split(":").map((p) => p.trim());
  if (parts.some((p) => !/^\d+$/.test(p))) return null;

  if (parts.length === 2) {
    const mm = toInt(parts[0]);
    const ss = toInt(parts[1]);
    if (mm == null || ss == null || ss >= 60) return null;
    return mm * 60 + ss;
  }

  if (parts.length === 3) {
    const hh = toInt(parts[0]);
    const mm = toInt(parts[1]);
    const ss = toInt(parts[2]);
    if (hh == null || mm == null || ss == null || mm >= 60 || ss >= 60) return null;
    return hh * 3600 + mm * 60 + ss;
  }

  return null;
}

function isCalibrationDone(d: any): boolean {
  const c = d?.calibration ?? d?.profile?.calibration ?? d?.user?.calibration ?? null;
  if (!c) return false;

  const status = safeStr(c?.status);
  if (status === "done") return true;
  if (c?.isDone === true || c?.completed === true) return true;

  const reqDays = toInt(c?.requiredDays);
  const doneDays = toInt(c?.completedDays);
  if (reqDays != null && doneDays != null) return doneDays >= reqDays;

  const reqS = toInt(c?.requiredSessions);
  const doneS = toInt(c?.completedSessions);
  if (reqS != null && doneS != null) return doneS >= reqS;

  return false;
}

function distancesFor(discipline: Discipline): number[] {
  return discipline === "trail" ? [5, 10, 21, 42, 80, 100] : [5, 10, 21, 42, 50, 100];
}

/* -------------------------------- component -------------------------------- */

export default function PlanSetupScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [onb, setOnb] = useState<any>(null);

  const [discipline, setDiscipline] = useState<Discipline>("road");
  const [goalKind, setGoalKind] = useState<GoalKind>("fitness");
  const [distanceKm, setDistanceKm] = useState<number>(10);
  const [trailProfile, setTrailProfile] = useState<TrailProfile>("rolling");

  // chrono (si time_goal)
  const [timeInput, setTimeInput] = useState(""); // "MM:SS" ou "HH:MM:SS"
  const targetTimeSec = useMemo(() => (goalKind === "time_goal" ? parseTimeToSec(timeInput) : null), [goalKind, timeInput]);

  // date optionnelle
  const [dateISO, setDateISO] = useState(""); // "YYYY-MM-DD" optionnel

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await onboarding.loadOnboarding().catch(() => null);
        if (!alive) return;

        setOnb(d);

        // guard : calibrage obligatoire avant setup plan
        if (!isCalibrationDone(d)) {
          router.replace("/calibration");
          return;
        }

        // pré-remplissage si déjà configuré
        const existing =
          d?.planSetup ?? d?.profile?.planSetup ?? d?.program ?? d?.profile?.program ?? null;

        const exDiscipline = safeStr(existing?.discipline) as Discipline | null;
        const exGoalKind = safeStr(existing?.goalKind) as GoalKind | null;
        const exDistance = toInt(existing?.distanceKm);
        const exDate = safeStr(existing?.eventDateISO);

        if (exDiscipline === "road" || exDiscipline === "trail") setDiscipline(exDiscipline);
        if (exGoalKind) setGoalKind(exGoalKind);
        if (exDistance != null) setDistanceKm(exDistance);
        if (exDate) setDateISO(exDate);

        const exTrailProfile = safeStr(existing?.trailProfile) as TrailProfile | null;
        if (exTrailProfile === "flat" || exTrailProfile === "rolling" || exTrailProfile === "mountain") {
          setTrailProfile(exTrailProfile);
        }

        const exTime = toInt(existing?.targetTimeSec);
        if (exTime != null && exTime > 0) {
          // on reconstruit un format simple MM:SS si < 1h, sinon HH:MM:SS
          const hh = Math.floor(exTime / 3600);
          const mm = Math.floor((exTime % 3600) / 60);
          const ss = exTime % 60;
          const pad = (n: number) => String(n).padStart(2, "0");
          setTimeInput(hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  const optsDistances = useMemo(() => distancesFor(discipline), [discipline]);

  useEffect(() => {
    // si la distance actuelle n'est plus dans la liste, on la remet sur la première dispo
    if (!optsDistances.includes(distanceKm)) setDistanceKm(optsDistances[0]);
  }, [optsDistances, distanceKm]);

  const canSave = useMemo(() => {
    if (goalKind === "time_goal" && !targetTimeSec) return false;
    if (dateISO.trim().length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(dateISO.trim())) return false;
    return true;
  }, [goalKind, targetTimeSec, dateISO]);

  const save = useCallback(async () => {
    if (!canSave) return;

    const patch: PlanSetup = {
      discipline,
      goalKind,
      distanceKm: goalKind === "weight_loss" || goalKind === "fitness" ? undefined : distanceKm,
      targetTimeSec: goalKind === "time_goal" ? targetTimeSec : null,
      eventDateISO: dateISO.trim().length ? dateISO.trim() : null,
      trailProfile: discipline === "trail" ? trailProfile : null,
      done: true,
    };

    // merge tolérant
    const current = onb ?? (await onboarding.loadOnboarding().catch(() => null)) ?? {};
    const next = {
      ...current,
      planSetup: patch,
      program: {
        ...(current?.program ?? {}),
        ...patch,
        isConfigured: true,
      },
    };

    await onboarding.saveOnboarding(next);
    router.replace("/(tabs)/plan");
  }, [canSave, discipline, goalKind, distanceKm, targetTimeSec, dateISO, trailProfile, onb, router]);

  if (loading) {
    return (
      <Screen>
        <View style={{ padding: 16 }}>
          <Text style={{ color: theme.colors.text2, fontWeight: "800" }}>Chargement…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <SectionTitle>Choisir ton plan</SectionTitle>

        {/* Discipline */}
        <Card>
          <Text style={s.label}>Discipline</Text>
          <View style={s.row}>
            <Chip label="Route" active={discipline === "road"} onPress={() => setDiscipline("road")} />
            <Chip label="Trail" active={discipline === "trail"} onPress={() => setDiscipline("trail")} />
          </View>
        </Card>

        {/* Objectif */}
        <Card>
          <Text style={s.label}>Objectif</Text>
          <View style={s.stack}>
            <Chip label="Perte de poids" active={goalKind === "weight_loss"} onPress={() => setGoalKind("weight_loss")} />
            <Chip label="Remise en forme" active={goalKind === "fitness"} onPress={() => setGoalKind("fitness")} />
            <Chip
              label="Finir une distance"
              active={goalKind === "finish_distance"}
              onPress={() => setGoalKind("finish_distance")}
            />
            <Chip label="Objectif chrono" active={goalKind === "time_goal"} onPress={() => setGoalKind("time_goal")} />
          </View>
        </Card>

        {/* Distance (si nécessaire) */}
        {goalKind === "finish_distance" || goalKind === "time_goal" ? (
          <Card>
            <Text style={s.label}>Distance</Text>
            <View style={s.rowWrap}>
              {optsDistances.map((d) => (
                <Chip key={d} label={`${d} km`} active={distanceKm === d} onPress={() => setDistanceKm(d)} />
              ))}
            </View>
          </Card>
        ) : null}

        {/* Trail profil */}
        {discipline === "trail" ? (
          <Card>
            <Text style={s.label}>Profil</Text>
            <View style={s.rowWrap}>
              <Chip label="Plat" active={trailProfile === "flat"} onPress={() => setTrailProfile("flat")} />
              <Chip label="Vallonné" active={trailProfile === "rolling"} onPress={() => setTrailProfile("rolling")} />
              <Chip label="Montagne" active={trailProfile === "mountain"} onPress={() => setTrailProfile("mountain")} />
            </View>
          </Card>
        ) : null}

        {/* Chrono */}
        {goalKind === "time_goal" ? (
          <Card>
            <Text style={s.label}>Temps visé</Text>
            <Text style={s.help}>Format : MM:SS (5/10k) ou HH:MM:SS (semi/marathon)</Text>
            <TextInput
              value={timeInput}
              onChangeText={setTimeInput}
              placeholder="ex : 45:00"
              placeholderTextColor={theme.colors.text2}
              style={s.input}
              keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "default"}
            />
            {!targetTimeSec ? <Text style={s.warn}>Temps invalide.</Text> : null}
          </Card>
        ) : null}

        {/* Date optionnelle */}
        <Card>
          <Text style={s.label}>Date d’événement (optionnel)</Text>
          <Text style={s.help}>Format : YYYY-MM-DD</Text>
          <TextInput
            value={dateISO}
            onChangeText={setDateISO}
            placeholder="ex : 2026-04-12"
            placeholderTextColor={theme.colors.text2}
            style={s.input}
          />
          {dateISO.trim().length > 0 && !/^\d{4}-\d{2}-\d{2}$/.test(dateISO.trim()) ? (
            <Text style={s.warn}>Date invalide.</Text>
          ) : null}
        </Card>

        <View style={{ opacity: canSave ? 1 : 0.55 }}>
          <ButtonPrimary label="Valider ce plan" onPress={save} />
        </View>

        <Pressable onPress={() => router.back()} style={{ paddingVertical: 6 }}>
          <Text style={{ color: theme.colors.text2, fontWeight: "900" }}>Retour</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

/* --------------------------------- UI bits -------------------------------- */

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.chip, active && s.chipActive, pressed && { opacity: 0.9 }]}>
      <Text style={[s.chipTxt, active && s.chipTxtActive]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  label: { color: theme.colors.text, fontWeight: "900", marginBottom: 10, fontSize: 13 },
  help: { color: theme.colors.text2, fontWeight: "800", marginTop: -6, marginBottom: 10, fontSize: 12 },
  warn: { marginTop: 10, color: theme.colors.primary, fontWeight: "900" },

  stack: { gap: 10 },
  row: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  rowWrap: { flexDirection: "row", gap: 10, flexWrap: "wrap" },

  chip: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  chipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipTxt: { color: theme.colors.text, fontWeight: "900" },
  chipTxtActive: { color: "#000" },

  input: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontWeight: "900",
  },
});
