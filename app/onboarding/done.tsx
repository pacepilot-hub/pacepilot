// app/onboarding/done.tsx
import React, { memo, useEffect, useRef, useState, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen, Card } from "@/components/ui";
import { theme } from "@/constants/theme";
import Logo from "../../assets/pacepilot-lockup.svg";

// ✅ Keys
const AUTH_KEY = "pacepilot:auth:v1"; // should store JSON tokens, not "1"
const ONB_COMPLETE_KEY = "pacepilot:onboarding:complete:v1"; // store JSON { plan_id, done_at }
const ONB_COMPLETE_PENDING_KEY = "pacepilot:onboarding:complete:pending:v1"; // for offline retries

type AuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_at?: string; // ISO
};

async function safeSet(key: string, value: string) {
  try {
    await AsyncStorage.setItem(key, value);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
}

async function safeGet(key: string) {
  try {
    const v = await AsyncStorage.getItem(key);
    return { ok: true as const, value: v };
  } catch (e: any) {
    return { ok: false as const, error: String(e?.message ?? e) };
  }
}

// ✅ tiny fetch wrapper (no new deps)
async function apiPost<T>(path: string, token: string, body: any): Promise<T> {
  const res = await fetch(`https://api.pacepilot.app/v1${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.message ? `${msg} — ${j.message}` : msg;
    } catch {}
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

type OnboardingCompleteResponse = { plan_id: string };

export default memo(function Done() {
  const router = useRouter();
  const aliveRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<"saving" | "ready" | "error">("saving");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const clearTimeoutSafe = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const goHome = useCallback(() => {
    if (!aliveRef.current) return;
    router.replace("/(tabs)/home");
  }, [router]);

  const init = useCallback(async () => {
    clearTimeoutSafe();
    setStatus("saving");
    setErrMsg(null);

    // 1) Read auth tokens (if any)
    const auth = await safeGet(AUTH_KEY);
    if (!auth.ok) throw new Error(auth.error);
    const tokens: AuthTokens | null = auth.value ? JSON.parse(auth.value) : null;

    // 2) Read onboarding payload (you likely stored start_date somewhere earlier)
    // Minimal MVP: if missing, fallback to today (but ideally read from onboarding storage)
    const today = new Date().toISOString().slice(0, 10);

    let plan_id: string | null = null;

    // 3) If we have access_token => call API onboarding/complete
    if (tokens?.access_token) {
      try {
        const r = await apiPost<OnboardingCompleteResponse>(
          "/onboarding/complete",
          tokens.access_token,
          { start_date: today } // TODO: replace by real onboarding data
        );
        plan_id = r.plan_id;
      } catch (e: any) {
        // If API fails, keep a pending marker for later sync
        await safeSet(
          ONB_COMPLETE_PENDING_KEY,
          JSON.stringify({ start_date: today, created_at: new Date().toISOString() })
        );
        // Not fatal for UX if you accept offline-first. But we surface the error.
        throw e;
      }
    } else {
      // No tokens => do NOT fake auth. Just mark onboarding pending.
      await safeSet(
        ONB_COMPLETE_PENDING_KEY,
        JSON.stringify({ start_date: today, created_at: new Date().toISOString() })
      );
    }

    // 4) Persist onboarding complete (plan_id if available)
    const onbPayload = { done_at: new Date().toISOString(), plan_id: plan_id ?? null };
    const a = await safeSet(ONB_COMPLETE_KEY, JSON.stringify(onbPayload));
    if (!a.ok) throw new Error(a.error);

    if (!aliveRef.current) return;

    setStatus("ready");

    timeoutRef.current = setTimeout(() => {
      if (!aliveRef.current) return;
      goHome();
    }, 650);
  }, [clearTimeoutSafe, goHome]);

  useEffect(() => {
    aliveRef.current = true;

    init().catch((e: any) => {
      if (!aliveRef.current) return;
      setStatus("error");
      setErrMsg(String(e?.message ?? e));
    });

    return () => {
      aliveRef.current = false;
      clearTimeoutSafe();
    };
  }, [init, clearTimeoutSafe]);

  return (
    <Screen>
      <View style={s.center}>
        <Logo width={220} height={70} />
        <Text style={s.appName}>PacePilot</Text>

        <Card style={s.card}>
          {status !== "error" ? (
            <>
              <Text style={s.title}>{status === "saving" ? "Finalisation…" : "C’est prêt"}</Text>
              <Text style={s.sub}>
                {status === "saving" ? "On sécurise ton profil et ton accès." : "On t’envoie sur l’accueil…"}
              </Text>

              <Pressable onPress={goHome} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}>
                <Text style={s.ctaTxt}>Aller à l’accueil</Text>
              </Pressable>

              <Text style={s.hint}>Tu peux continuer tout de suite.</Text>
            </>
          ) : (
            <>
              <Text style={s.title}>Petit souci</Text>
              <Text style={s.sub}>On n’a pas pu finaliser correctement.</Text>

              {!!errMsg && (
                <Text style={s.err} numberOfLines={3}>
                  {errMsg}
                </Text>
              )}

              <View style={s.row}>
                <Pressable onPress={() => init()} style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}>
                  <Text style={s.ctaTxt}>Réessayer</Text>
                </Pressable>

                <Pressable onPress={goHome} style={({ pressed }) => [s.ctaGhost, pressed && { opacity: 0.85 }]}>
                  <Text style={s.ctaGhostTxt}>Continuer</Text>
                </Pressable>
              </View>

              <Text style={s.hint}>Si ça persiste, on resynchronisera quand le réseau revient.</Text>
            </>
          )}
        </Card>
      </View>
    </Screen>
  );
});

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20, gap: 12 },
  appName: { color: theme.colors.text, fontWeight: "900", fontSize: 18 },
  card: {
    width: "100%",
    maxWidth: 420,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 6, color: theme.colors.text2, fontWeight: "800", lineHeight: 18 },
  cta: {
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  ctaTxt: { color: "#000", fontWeight: "900" },
  ctaGhost: {
    marginTop: 12,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    flex: 1,
  },
  ctaGhostTxt: { color: theme.colors.text, fontWeight: "900" },
  row: { flexDirection: "row", gap: 10 },
  hint: { marginTop: 8, color: theme.colors.text2, fontWeight: "700", fontSize: 12 },
  err: { marginTop: 8, color: theme.colors.text2, fontWeight: "800", fontSize: 12 },
});
