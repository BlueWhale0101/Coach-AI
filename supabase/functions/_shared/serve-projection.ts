import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createProjectionHandler } from "./projection-api.mjs";
import { SupabaseProjectionRepository } from "./supabase-projection-repository.mjs";

export function serveProjectionOperation() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const configured = Boolean(url && key);
  const client = configured ? createClient(url, key, { auth: { persistSession: false } }) : null;
  const repository = client ? new SupabaseProjectionRepository(client) : null;
  serve(createProjectionHandler({
    repository,
    actionSecret: Deno.env.get("ACTION_API_SECRET"),
    databaseConfigured: configured,
  }));
}
