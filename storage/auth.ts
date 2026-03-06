import AsyncStorage from "@react-native-async-storage/async-storage";

import { STORAGE } from "@/storage/constants";

function randomHex(size: number): string {
  let out = "";
  while (out.length < size) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out.slice(0, size);
}

function createPseudoUuid(): string {
  // UUIDv4-like, enough for local user identity in MVP auth.
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-a${randomHex(3)}-${randomHex(12)}`;
}

export async function getLocalUserId(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(STORAGE.auth.userId);
    const s = String(v ?? "").trim();
    return s.length ? s : null;
  } catch {
    return null;
  }
}

export async function ensureLocalUserId(): Promise<string> {
  const existing = await getLocalUserId();
  if (existing) return existing;

  const next = createPseudoUuid();
  try {
    await AsyncStorage.setItem(STORAGE.auth.userId, next);
  } catch {
    // keep returning generated value for current flow even if persistence failed
  }
  return next;
}
