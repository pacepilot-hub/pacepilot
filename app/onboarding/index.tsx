// app/onboarding/index.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { theme } from "@/constants/theme";
import PacepilotMark from "@/components/PacepilotMark";
import * as onboarding from "@/storage/onboarding";

const ONB_COMPLETE_KEY = "pacepilot:onboarding:complete:v1";

export default function OnboardingSplash() {
  const router = useRouter();

  // ✅ anti double nav
  const navigatingRef = useRef(false);
  const didStartRef = useRef(false);

  // UI state
  const [canContinue, setCanContinue] = useState(false);

  // anims
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.96);
  const translateY = useSharedValue(10);

  // ✅ gate dédiée (timer)
  const gate = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  const stopAnimsAndLockFinal = useCallback(() => {
    cancelAnimation(opacity);
    cancelAnimation(scale);
    cancelAnimation(translateY);
    cancelAnimation(gate);
    opacity.value = 1;
    scale.value = 1;
    translateY.value = 0;
    gate.value = 1;
  }, [opacity, scale, translateY, gate]);

  const decideNextRoute = useCallback(async () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;

    try {
      const data = await onboarding.loadOnboarding();
      const hasProgram = onboarding.isProgramComplete(data);

      if (!hasProgram) {
        router.replace("/onboarding/program");
        return;
      }

      // ✅ si program complet : check finalisation
      const doneRaw = await AsyncStorage.getItem(ONB_COMPLETE_KEY);
      const isDone = !!doneRaw && doneRaw !== "0";

      if (!isDone) {
        router.replace("/onboarding/done");
        return;
      }

      router.replace("/(tabs)/home");
    } catch (e: any) {
      console.log("Splash onboarding error:", e?.message ?? e);
      router.replace("/onboarding/program");
    }
  }, [router]);

  // ✅ tap user: force go même si canContinue pas encore true
  const goNext = useCallback(
    (force?: boolean) => {
      if (!force && !canContinue) return;
      stopAnimsAndLockFinal();
      decideNextRoute().catch(() => {});
    },
    [canContinue, stopAnimsAndLockFinal, decideNextRoute]
  );

  useEffect(() => {
    if (didStartRef.current) return;
    didStartRef.current = true;

    // entrée
    opacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    translateY.value = withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) });

    scale.value = withSequence(
      withTiming(1.03, { duration: 520, easing: Easing.inOut(Easing.sin) }),
      withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) })
    );

    // ✅ après 1400ms: autoriser + auto nav
    const allowAndAuto = () => {
      setCanContinue(true);
      decideNextRoute().catch(() => {});
    };

    gate.value = withDelay(
      1400,
      withTiming(1, { duration: 1 }, () => {
        runOnJS(allowAndAuto)();
      })
    );

    return () => {
      stopAnimsAndLockFinal();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Pressable style={s.root} onPress={() => goNext(true)}>
      <View style={s.center}>
        <Animated.View style={animatedStyle}>
          <PacepilotMark width={300} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
