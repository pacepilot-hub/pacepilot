// app/(auth)/login.tsx
import React, { useMemo, useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen, Card, ButtonPrimary } from "@/components/ui";
import { theme } from "@/constants/theme";
import * as onboarding from "@/storage/onboarding";
import { ensureLocalUserId } from "@/storage/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { markLegacyAuthFlag } from "@/storage/authSession";

/* -------------------------------- helpers -------------------------------- */

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function safeStr(x: any) {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

function toInt(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * ✅ Profil complet = on a minimum vital:
 * - name, age, weight, sessionsPerWeek, coachTone
 * - sports (primarySport ou practicedSports)
 * - injuries ok même vide
 *
 * ⚠️ tolère plusieurs shapes (top-level / profile / user)
 */
function isProfileComplete(d: any): boolean {
  if (!d) return false;

  const p = d?.profile ?? d?.user ?? d;

  const name = safeStr(p?.name);
  const age = toInt(p?.age);
  const weight = toInt(p?.weightKg ?? p?.weight);

  const sessionsPerWeek = toInt(p?.sessionsPerWeek ?? p?.training?.sessionsPerWeek);

  const coachTone = safeStr(p?.coachTone ?? p?.coach?.tone);
  const primarySport = safeStr(p?.primarySport ?? p?.sports?.primarySport);
  const practicedSports = p?.practicedSports ?? p?.sports?.practicedSports ?? p?.sports;

  const hasSports =
    !!primarySport ||
    (Array.isArray(practicedSports) && practicedSports.length > 0) ||
    (practicedSports && typeof practicedSports === "object" && Object.keys(practicedSports).length > 0);

  return !!(name && age != null && age > 0 && weight != null && weight > 0 && sessionsPerWeek != null && sessionsPerWeek >= 1 && coachTone && hasSports);
}

/**
 * ✅ Calibrage terminé ?
 * - supporte calibration.requiredDays/completedDays
 * - ou requiredSessions/completedSessions
 * - ou status === "done"
 */
function isCalibrationDone(d: any): boolean {
  if (!d) return false;

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

/**
 * ✅ Plan setup terminé ?
 * On ne met PAS objectif/difficulté dans le profil,
 * donc après calibrage il faut un état "planSetup".
 *
 * tolère:
 * - d.planSetup.done
 * - d.program.isConfigured
 * - d.planMeta.goalKind (ou un champ équivalent)
 */
function isPlanSetupDone(d: any): boolean {
  if (!d) return false;

  const ps = d?.planSetup ?? d?.profile?.planSetup ?? d?.user?.planSetup ?? null;
  if (ps?.done === true) return true;

  const program = d?.program ?? d?.profile?.program ?? null;
  if (program?.isConfigured === true) return true;

  const goalKind = safeStr(program?.goalKind ?? program?.goal?.kind ?? d?.goalKind);
  if (goalKind) return true;

  return false;
}

type NextRoute = "/onboarding/profile" | "/calibration" | "/plan-setup" | "/(tabs)/home";

/**
 * ✅ Détermine la route suivante sans dépendre d'un flag AsyncStorage fragile.
 */
function computeNextRoute(onb: any): NextRoute {
  if (!isProfileComplete(onb)) return "/onboarding/profile";
  if (!isCalibrationDone(onb)) return "/calibration";
  if (!isPlanSetupDone(onb)) return "/plan-setup";
  return "/(tabs)/home";
}

/* -------------------------------- component -------------------------------- */

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const valid = useMemo(() => isEmail(email) && password.trim().length >= 4, [email, password]);

  const onLogin = useCallback(async () => {
    if (!valid || loading) return;

    setLoading(true);
    setErr(null);

    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        throw new Error("Supabase non configuré. Renseigne supabaseUrl/supabaseAnonKey dans app.json.");
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) throw new Error(error.message);

      await markLegacyAuthFlag(true);
      await ensureLocalUserId();

      // ✅ route selon l'état réel
      const onb = await onboarding.loadOnboarding().catch(() => null);
      const next = computeNextRoute(onb);

      router.replace(next);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }, [valid, loading, router]);

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={s.h1}>Se connecter</Text>

        <Card>
          <Text style={s.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="toi@mail.com"
            placeholderTextColor={theme.colors.text2}
            style={s.input}
          />

          <Text style={s.label}>Mot de passe</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••"
            placeholderTextColor={theme.colors.text2}
            style={s.input}
          />

          {err ? <Text style={s.err}>{err}</Text> : null}

          <View style={{ marginTop: 14, opacity: !valid || loading ? 0.55 : 1 }}>
            <ButtonPrimary label={loading ? "Connexion…" : "Se connecter"} onPress={onLogin} />
          </View>

          <Pressable onPress={() => router.push("/(auth)/signup")} style={{ marginTop: 12 }}>
            <Text style={s.link}>Créer un compte</Text>
          </Pressable>
        </Card>
      </View>
    </Screen>
  );
}

/* --------------------------------- styles ---------------------------------- */

const s = StyleSheet.create({
  h1: { color: theme.colors.text, fontSize: 26, fontWeight: "900" },
  label: { marginTop: 12, marginBottom: 6, color: theme.colors.text, fontWeight: "800" },
  input: {
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    color: theme.colors.text,
    fontWeight: "800",
  },
  link: { color: theme.colors.primary, fontWeight: "900" },
  err: { marginTop: 10, color: theme.colors.primary, fontWeight: "900" },
});
