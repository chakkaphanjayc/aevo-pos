import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface Database {
  /** A server-side Supabase client. The key must never be exposed to a browser. */
  readonly client: SupabaseClient;
  ping(): Promise<void>;
  /** Supabase clients use HTTP and do not hold sockets. */
  close(): Promise<void>;
}

/**
 * Create a Supabase client for the API/Worker runtime.
 *
 * The API deliberately uses the server-only secret key. Row Level Security is
 * still enabled on every public table; server routes enforce the authenticated
 * principal and tenant boundary before returning data.
 */
export function createDatabase(supabaseUrl: string, supabaseKey: string): Database {
  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    },
    global: {
      headers: { "x-aevo-runtime": "api" }
    }
  });

  return {
    client,
    ping: async () => {
      const { error } = await client.from("organizations").select("id").limit(1);
      if (error) throw new Error(`Supabase readiness check failed: ${error.message}`);
    },
    close: async () => undefined
  };
}
