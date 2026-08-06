export const WEB_AUTH_CHANNEL = "sportfolio-web-auth";

export function normalizePasswordlessReturnTo(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  return candidate;
}

export async function requestPasswordlessEmail(email: string, returnTo: string) {
  const response = await fetch("/api/auth/web/request", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, returnTo: normalizePasswordlessReturnTo(returnTo) }),
  });
  if (response.status === 400) throw new Error("Please enter a valid email address.");
  if (!response.ok) throw new Error("Authentication is temporarily unavailable.");
  return { accepted: true as const };
}

export function broadcastWebAuthChange(type: "signed-in" | "signed-out") {
  if (typeof window === "undefined") return;
  try {
    const channel = new BroadcastChannel(WEB_AUTH_CHANNEL);
    channel.postMessage({ type });
    channel.close();
  } catch {
    window.localStorage.setItem(WEB_AUTH_CHANNEL, `${type}:${Date.now()}`);
  }
}
