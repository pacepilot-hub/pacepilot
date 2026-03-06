import AsyncStorage from "@react-native-async-storage/async-storage";

import { hasSupabaseSession } from "@/lib/supabase";

export const AUTH_KEY = "pacepilot:auth:v1";

async function safeGetBool(key: string): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(key);
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const supabaseState = await hasSupabaseSession();
  if (supabaseState !== null) {
    return supabaseState;
  }

  // fallback legacy if Supabase not configured
  return safeGetBool(AUTH_KEY);
}

export async function markLegacyAuthFlag(value: boolean): Promise<void> {
  try {
    if (value) await AsyncStorage.setItem(AUTH_KEY, "1");
    else await AsyncStorage.removeItem(AUTH_KEY);
  } catch {
    // noop
  }
}
