// app/splash.tsx
import React, { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { Screen } from "@/components/ui";
import { theme } from "@/constants/theme";
import PacepilotMark from "@/components/PacepilotMark";
import { isAuthenticated } from "@/storage/authSession";

const ONB_COMPLETE_KEY = "pacepilot:onboarding:complete:v1";

export default function Splash() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    (async () => {
      const minDelay = 1200;
      const t0 = Date.now();

      try {
        const [authed, onbRaw] = await Promise.all([
          isAuthenticated(),
          AsyncStorage.getItem(ONB_COMPLETE_KEY),
        ]);

        const spent = Date.now() - t0;
        if (spent < minDelay) {
          await new Promise((r) => setTimeout(r, minDelay - spent));
        }

        if (!alive) return;

        if (authed && onbRaw === "1") {
          router.replace("/(tabs)/home");
        } else {
          router.replace("/(auth)/login");
        }
      } catch {
        if (!alive) return;
        router.replace("/(auth)/login");
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <Screen>
      <View style={s.center}>
        {/* 👇 ICI le logo */}
        <PacepilotMark width={220} />

        <Text style={s.name}>PacePilot</Text>
        <Text style={s.tag}>Coach running intelligent</Text>
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  name: {
    marginTop: 10,
    fontSize: 20,
    fontWeight: "900",
    color: theme.colors.text,
  },
  tag: {
    marginTop: 6,
    fontWeight: "700",
    color: theme.colors.text2,
  },
});
