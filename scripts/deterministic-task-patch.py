from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

app_path = ROOT / "client/src/App.tsx"
app = app_path.read_text(encoding="utf-8")
app = app.replace('const loadAuthCallbackPage = () => import("@/pages/AuthCallback");\n', '')
app = app.replace('const AuthCallback = lazy(loadAuthCallbackPage);\n', '')
app_path.write_text(app, encoding="utf-8")

query_path = ROOT / "client/src/lib/queryClient.ts"
query = query_path.read_text(encoding="utf-8")
query = query.replace(
    'import { getAuthSession, getSupabase } from "./supabase";\n',
    'import { getNativeAuthToken } from "./native-auth";\n',
)
old = '''export async function getAuthHeaders(): Promise<HeadersInit> {\n  try {\n    const supabase = await getSupabase();\n    const session = await getAuthSession(supabase);\n    if (session?.access_token) {\n      return { Authorization: `Bearer ${session.access_token}` };\n    }\n  } catch (error) {\n    debugLog("AUTH_HEADERS", "Failed to get auth headers", { error: (error as Error).message });\n  }\n  return {};\n}\n'''
new = '''export async function getAuthHeaders(): Promise<HeadersInit> {\n  if (getClientPlatform() === "web") return {};\n\n  try {\n    const accessToken = getNativeAuthToken();\n    if (accessToken) {\n      return { Authorization: `Bearer ${accessToken}` };\n    }\n  } catch (error) {\n    debugLog("AUTH_HEADERS", "Failed to get native auth headers", {\n      error: (error as Error).message,\n    });\n  }\n  return {};\n}\n'''
if old not in query:
    raise SystemExit("legacy queryClient auth block not found")
query = query.replace(old, new)
query_path.write_text(query, encoding="utf-8")
