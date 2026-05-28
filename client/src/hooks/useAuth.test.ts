import { describe, expect, it, vi } from "vitest";
import { startOAuthLogin } from "./useAuth";

function createSupabaseClientMock() {
  return {
    auth: {
      signInWithOAuth: vi.fn(),
    },
  } as any;
}

describe("startOAuthLogin", () => {
  it("starts native Apple OAuth with mobile callback and browser open", async () => {
    const supabaseClient = createSupabaseClientMock();
    supabaseClient.auth.signInWithOAuth.mockResolvedValue({
      data: { url: "https://oauth.example.com/apple" },
      error: null,
    });
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    await startOAuthLogin({
      supabaseClient,
      provider: "apple",
      isNativePlatform: true,
      openBrowser,
      mobileAuthRedirectUrl: "sportfolio://auth/callback",
    });

    expect(supabaseClient.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "sportfolio://auth/callback",
        skipBrowserRedirect: true,
      },
    });
    expect(openBrowser).toHaveBeenCalledWith("https://oauth.example.com/apple");
  });

  it("starts web Apple OAuth with post-login redirect persistence", async () => {
    const supabaseClient = createSupabaseClientMock();
    supabaseClient.auth.signInWithOAuth.mockResolvedValue({
      data: {},
      error: null,
    });
    const setPostAuthRedirect = vi.fn();

    await startOAuthLogin({
      supabaseClient,
      provider: "apple",
      isNativePlatform: false,
      postAuthRedirectPath: "/portfolio",
      webAuthRedirectUrl: "https://www.sportfolio.market/auth/callback",
      setPostAuthRedirect,
    });

    expect(setPostAuthRedirect).toHaveBeenCalledWith("/portfolio");
    expect(supabaseClient.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "apple",
      options: {
        redirectTo: "https://www.sportfolio.market/auth/callback",
      },
    });
  });

  it("rejects native OAuth when Supabase does not return a browser URL", async () => {
    const supabaseClient = createSupabaseClientMock();
    supabaseClient.auth.signInWithOAuth.mockResolvedValue({
      data: {},
      error: null,
    });

    await expect(
      startOAuthLogin({
        supabaseClient,
        provider: "apple",
        isNativePlatform: true,
      }),
    ).rejects.toThrow("Could not start mobile OAuth flow");
  });
});
