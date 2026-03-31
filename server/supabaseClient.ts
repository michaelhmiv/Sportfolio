import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseConfigured = Boolean(supabaseUrl && supabaseServiceRoleKey);

if (!supabaseConfigured) {
  console.warn("Supabase environment variables not configured. Auth features will not work.");
}

export const supabaseAdmin = supabaseConfigured
  ? createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

export async function verifySupabaseToken(token: string) {
  if (!supabaseAdmin) return null;
  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    return user;
  } catch (error) {
    console.error("Error verifying Supabase token:", error);
    return null;
  }
}
