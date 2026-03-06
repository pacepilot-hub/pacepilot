// app/(auth)/signup.tsx
import React, { useMemo, useState, useCallback } from "react";
import { View, Text, TextInput, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen, Card, ButtonPrimary } from "@/components/ui";
import { theme } from "@/constants/theme";
import * as onboarding from "@/storage/onboarding";

const AUTH_KEY = "pacepilot:auth:v1";

// ⚠️ fallback si ton storage/onboarding n'a pas encore reset()
const ONB_STORAGE_FALLBACK_KEY = "pacepilot:onboarding:v1";

function isEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export default function Signup() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const valid = useMemo(() => isEmail(email) && password.trim().length >= 4, [email, password]);

  const onCreate = useCallback(async () => {
    if (!valid || loading) return;

    setLoading(true);
    try {
      // ✅ session ouverte (mock)
      await AsyncStorage.setItem(AUTH_KEY, "1");

      // ✅ reset onboarding pour forcer un profil propre
      const anyReset = (onboarding as any)?.resetOnboarding;
      if (typeof anyReset === "function") {
        await anyReset();
      } else {
        // fallback safe (ne casse rien si la clé n'existe pas)
        await AsyncStorage.removeItem(ONB_STORAGE_FALLBACK_KEY);
      }

      // 👉 on démarre le flow profil
      router.replace("/onboarding/profile");
    } finally {
      setLoading(false);
    }
  }, [valid, loading, router]);

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={s.h1}>Créer un compte</Text>

        <Card>
          <Text style={s.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
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

          <View style={{ marginTop: 14, opacity: !valid || loading ? 0.55 : 1 }}>
            <ButtonPrimary label={loading ? "Création…" : "Créer"} onPress={onCreate} />
          </View>

          <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={s.link}>J’ai déjà un compte</Text>
          </Pressable>
        </Card>
      </View>
    </Screen>
  );
}

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
});
