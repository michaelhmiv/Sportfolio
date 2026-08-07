import { Capacitor } from "@capacitor/core";
import { resolveApiUrl } from "./native-runtime";
import { broadcastWebAuthChange } from "./passwordless-auth";

const NATIVE_TOKEN_KEY = "sportfolio_native_auth_token_v1";
const NATIVE_BINDING_KEY = "sportfolio_native_auth_binding_v1";

export type NativeAuthSession = {
  accessToken: string;
  expiresAt: string;
  userId: string;
};

function platform(): "ios" | "android" {
  const value = Capacitor.getPlatform();
  if (value !== "ios" && value !== "android") {
    throw new Error("Native authentication is only available on iOS and Android.");
  }
  return value;
}

function randomBinding(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  }
  const values = new Uint8Array(32);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function getNativeAuthSession(): NativeAuthSession | null {
  try {
    const raw = localStorage.getItem(NATIVE_TOKEN_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as NativeAuthSession;
    if (!session.accessToken || !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(NATIVE_TOKEN_KEY);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(NATIVE_TOKEN_KEY);
    return null;
  }
}

export function getNativeAuthToken(): string | null {
  return getNativeAuthSession()?.accessToken ?? null;
}

export async function requestNativeMagicLink(email: string): Promise<void> {
  const binding = randomBinding();
  localStorage.setItem(NATIVE_BINDING_KEY, binding);
  const response = await fetch(resolveApiUrl("/api/auth/native/request"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, platform: platform(), binding }),
  });
  if (!response.ok) {
    localStorage.removeItem(NATIVE_BINDING_KEY);
    throw new Error("Authentication is temporarily unavailable.");
  }
}

export async function exchangeNativeAuthHandoff(code: string): Promise<NativeAuthSession> {
  const binding = localStorage.getItem(NATIVE_BINDING_KEY);
  if (!binding) throw new Error("This sign-in request was not started on this device.");

  const response = await fetch(resolveApiUrl("/api/auth/native/exchange"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code, binding, platform: platform() }),
  });
  if (!response.ok) throw new Error("This sign-in link is invalid or has expired.");

  const payload = (await response.json()) as NativeAuthSession;
  if (!payload.accessToken || !payload.expiresAt || !payload.userId) {
    throw new Error("The native session response was incomplete.");
  }
  localStorage.setItem(NATIVE_TOKEN_KEY, JSON.stringify(payload));
  localStorage.removeItem(NATIVE_BINDING_KEY);
  broadcastWebAuthChange("signed-in");
  return payload;
}

export async function clearNativeAuthSession(): Promise<void> {
  const token = getNativeAuthToken();
  localStorage.removeItem(NATIVE_TOKEN_KEY);
  localStorage.removeItem(NATIVE_BINDING_KEY);
  if (token) {
    await fetch(resolveApiUrl("/api/auth/native/logout"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => undefined);
  }
  broadcastWebAuthChange("signed-out");
}
