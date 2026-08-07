from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "client/src/App.tsx"
source = path.read_text(encoding="utf-8")
source = source.replace(
    'import { getAuthSession, getSupabase, updateNativeAuthRefreshState } from "@/lib/supabase";\n',
    'import { exchangeNativeAuthHandoff } from "@/lib/native-auth";\n',
)

start = source.index('        // Handle auth callback — close the in-app browser first')
end = source.index('        const route = resolveNativeAppUrlToRoute(url);', start)
replacement = '''        // Complete the device-bound passwordless handoff directly in the app.
        if (url.startsWith("sportfolio://auth/callback")) {
          try {
            const callbackUrl = new URL(url);
            const code = callbackUrl.searchParams.get("code");
            if (!code) throw new Error("Native sign-in callback did not include a handoff code.");
            await exchangeNativeAuthHandoff(code);
            navigate("/", { replace: true });
          } catch (error) {
            console.error("[MOBILE_AUTH] Passwordless handoff failed:", error);
            navigate("/auth/error?error=native_handoff_failed", { replace: true });
          } finally {
            const { Browser } = await import("@capacitor/browser");
            await Browser.close().catch(() => undefined);
          }
          return;
        }

'''
source = source[:start] + replacement + source[end:]

state_start = source.index('  useEffect(() => {\n    if (!isNativePlatform) {\n      return;\n    }\n\n    let listener: { remove: () => Promise<void> } | null = null;\n\n    const register = async () => {\n      const { App: CapacitorApp } = await import("@capacitor/app");\n      listener = await CapacitorApp.addListener("appStateChange"')
state_end = source.index('  // P0 — 1.2: Android back button handling', state_start)
source = source[:state_start] + '''  // Native passwordless bearer sessions do not require an app-resume token refresh loop.

''' + source[state_end:]

path.write_text(source, encoding="utf-8")
