import React, { PropsWithChildren, useMemo } from "react";
import { View, StyleProp, ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  onDoubleTap?: () => void;
  onLongPress?: () => void;

  /** réglages optionnels */
  longPressMs?: number; // default 220
  doubleTapDelayMs?: number; // default 240
  hitSlop?: number; // default 6
  enabled?: boolean; // default true
}>;

/**
 * SmartCard
 * - Wrapper "card" qui supporte:
 *   - Long press (prioritaire)
 *   - Double tap
 * - Pas de conflit avec scroll (grâce au Gesture.Exclusive)
 * - Rend un vrai <View> pour supporter style / layout
 */
export default function SmartCard({
  style,
  onDoubleTap,
  onLongPress,
  longPressMs = 220,
  doubleTapDelayMs = 240,
  hitSlop = 6,
  enabled = true,
  children,
}: Props) {
  const gesture = useMemo(() => {
    const longPress = Gesture.LongPress()
      .enabled(enabled && !!onLongPress)
      .minDuration(longPressMs)
      .hitSlop(hitSlop)
      .onStart(() => {
        onLongPress?.();
      });

    const doubleTap = Gesture.Tap()
      .enabled(enabled && !!onDoubleTap)
      .numberOfTaps(2)
      .maxDelay(doubleTapDelayMs)
      .hitSlop(hitSlop)
      .onEnd((_, success) => {
        if (success) onDoubleTap?.();
      });

    // ✅ priorité au long press, sinon double tap
    return Gesture.Exclusive(longPress, doubleTap);
  }, [enabled, onLongPress, onDoubleTap, longPressMs, doubleTapDelayMs, hitSlop]);

  // ✅ si rien n’est branché, on évite GestureDetector (et donc toute surprise)
  const hasAny = !!onLongPress || !!onDoubleTap;

  const content = <View style={style}>{children}</View>;

  if (!hasAny || !enabled) return content;

  return <GestureDetector gesture={gesture}>{content}</GestureDetector>;
}
