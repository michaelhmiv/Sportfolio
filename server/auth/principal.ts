import type { Request } from "express";

export type AuthProvider = "supabase" | "better-auth" | "native-better-auth" | "development";
export type AuthPrincipal = {
  userId: string;
  provider: AuthProvider;
  providerSubject: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  sessionId?: string | null;
  scopes?: readonly string[];
};

type PrincipalRequest = Request & {
  authPrincipal?: AuthPrincipal;
  user?: ReturnType<typeof toLegacyRequestUser>;
};

export function toLegacyRequestUser(principal: AuthPrincipal) {
  return {
    claims: {
      sub: principal.userId,
      email: principal.email ?? undefined,
      first_name: principal.firstName ?? undefined,
      last_name: principal.lastName ?? undefined,
    },
  };
}

export function attachAuthPrincipal(req: Request, principal: AuthPrincipal): void {
  const target = req as PrincipalRequest;
  target.authPrincipal = principal;
  target.user = toLegacyRequestUser(principal);
}

export function getAuthPrincipal(req: Request): AuthPrincipal | null {
  return (req as PrincipalRequest).authPrincipal ?? null;
}

export function requireAuthPrincipal(req: Request): AuthPrincipal {
  const principal = getAuthPrincipal(req);
  if (!principal) throw new Error("AUTH_PRINCIPAL_MISSING");
  return principal;
}
