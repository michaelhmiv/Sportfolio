export type PublicAuthCapabilities = {
  passwordlessWeb: boolean;
  nativeHandoff: boolean;
};

const legacyFallback: PublicAuthCapabilities = {
  passwordlessWeb: false,
  nativeHandoff: false,
};

let cachedRequest: Promise<PublicAuthCapabilities> | null = null;

export function resetAuthCapabilitiesCacheForTests(): void {
  cachedRequest = null;
}

export function fetchAuthCapabilities(): Promise<PublicAuthCapabilities> {
  cachedRequest ??= fetch("/api/auth/capabilities", {
    credentials: "include",
    headers: { accept: "application/json" },
  })
    .then(async (response) => {
      if (!response.ok) return legacyFallback;
      const payload = (await response.json()) as Partial<PublicAuthCapabilities>;
      return {
        passwordlessWeb: payload.passwordlessWeb === true,
        nativeHandoff: payload.nativeHandoff === true,
      };
    })
    .catch(() => legacyFallback);
  return cachedRequest;
}
