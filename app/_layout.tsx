import "react-native-gesture-handler";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";

const AUTH_KEY = "pacepilot:auth:v1";
const ONB_COMPLETE_KEY = "pacepilot:onboarding:complete:v1";

SplashScreen.preventAutoHideAsync().catch(() => {});

/* ---------------------------------- utils --------------------------------- */

async function safeGetBool(key: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

function isPublicPath(pathname: string) {
  return pathname === "/splash";
}

function computeTarget(pathname: string, authed: boolean, onbDone: boolean): string | null {
  const inAuth = pathname.startsWith("/(auth)");
  const inTabs = pathname.startsWith("/(tabs)");
  const inOnboarding = pathname.startsWith("/onboarding");

  if (!authed) return inAuth ? null : "/(auth)/login";
  if (!onbDone) return inOnboarding ? null : "/onboarding/profile";
  return inTabs ? null : "/(tabs)/home";
}

/* --------------------------------- layout --------------------------------- */

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();

  const guardRunningRef = useRef(false);
  const lastTargetRef = useRef<string | null>(null);

  const splashHiddenRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // cache session
  const flagsRef = useRef<{ authed?: boolean; onbDone?: boolean } | null>(null);

  const [fontsLoaded] = useFonts({
    Satoshi: require("../assets/fonts/Satoshi-Variable.ttf"),
    "Satoshi-Italic": require("../assets/fonts/Satoshi-VariableItalic.ttf"),
  });

  const hideSplashOnce = useCallback(async () => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    try {
      await SplashScreen.hideAsync();
    } catch {}
  }, []);

  useEffect(() => {
    let alive = true;

    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => {
      if (!alive) return;
      hideSplashOnce();
    }, 2000);

    if (fontsLoaded) hideSplashOnce();

    return () => {
      alive = false;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    };
  }, [fontsLoaded, hideSplashOnce]);

  useEffect(() => {
    let alive = true;

    if (!pathname) return;
    if (isPublicPath(pathname)) return;
    if (guardRunningRef.current) return;

    guardRunningRef.current = true;

    (async () => {
      try {
        let authed: boolean;
        let onbDone: boolean;

        if (flagsRef.current && typeof flagsRef.current.authed === "boolean" && typeof flagsRef.current.onbDone === "boolean") {
          authed = flagsRef.current.authed;
          onbDone = flagsRef.current.onbDone;
        } else {
          [authed, onbDone] = await Promise.all([safeGetBool(AUTH_KEY), safeGetBool(ONB_COMPLETE_KEY)]);
          flagsRef.current = { authed, onbDone };
        }

        if (!alive) return;

        const target = computeTarget(pathname, authed, onbDone);
        if (!target || target === pathname) return;

        if (lastTargetRef.current === target) return;
        lastTargetRef.current = target;

        requestAnimationFrame(() => {
          try {
            router.replace(target);
          } catch {}
        });
      } catch (e: any) {
        console.warn("[guard] failed", String(e?.message ?? e));
      } finally {
        guardRunningRef.current = false;
      }
    })();

    return () => {
      alive = false;
      guardRunningRef.current = false;
    };
  }, [pathname, router]);

  const stackOptions = useMemo(
    () => ({
      headerShown: false,
      gestureEnabled: false,
      animation: Platform.OS === "android" ? ("fade" as const) : ("default" as const),
    }),
    []
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* ✅ laisse Expo Router gérer les segments */}
      <Stack screenOptions={stackOptions} />
    </GestureHandlerRootView>
  );
}
