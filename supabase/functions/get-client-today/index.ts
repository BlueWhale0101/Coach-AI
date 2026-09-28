import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createWidgetTodayHandler } from "../_shared/widget-today-api.mjs";
import { SupabaseProjectionRepository } from "../_shared/supabase-projection-repository.mjs";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
const actionSecret = Deno.env.get("ACTION_API_SECRET") ?? "";
const configured = Boolean(url && key);
const client = configured ? createClient(url, key, { auth: { persistSession: false } }) : null;

serve(createWidgetTodayHandler({
  repository: client ? new SupabaseProjectionRepository(client) : null,
  credentials: {
    async find(hash: string) {
      const { data, error } = await client!.from("assistant_widget_client_credentials")
        .select("scope,expires_at,revoked_at").eq("token_hash", hash).maybeSingle();
      if (error) throw error;
      return data;
    },
  },
  actionSecret,
  configured,
}));
