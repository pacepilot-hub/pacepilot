import Constants from "expo-constants";

type ExtraConfig = {
  apiUrl?: string;
  apiProdUrl?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

function getExtra(): ExtraConfig {
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as ExtraConfig;
  return expoExtra;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getApiBaseUrl(override?: string): string {
  const extra = getExtra();
  const devDefault = extra.apiUrl ?? "http://localhost:3333";
  const prodDefault = extra.apiProdUrl ?? devDefault;

  const raw = String(override ?? (__DEV__ ? devDefault : prodDefault)).trim();
  if (!raw) return "http://localhost:3333";
  return trimTrailingSlash(raw);
}

export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const extra = getExtra();

  const url = String(extra.supabaseUrl ?? "").trim();
  const anonKey = String(extra.supabaseAnonKey ?? "").trim();

  if (!url || !anonKey) return null;
  return { url: trimTrailingSlash(url), anonKey };
}

export function isSupabaseConfigured(): boolean {
  return !!getSupabaseConfig();
}
