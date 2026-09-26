import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createAttentionHandler } from "./attention-api.mjs";
import { SupabaseAttentionRepository } from "./supabase-attention-repository.mjs";

export function serveAttentionOperation(operation: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const configured = Boolean(url && key);
  const client = configured ? createClient(url, key, { auth: { persistSession: false } }) : null;
  serve(createAttentionHandler({ operation, repository: client ? new SupabaseAttentionRepository(client) : null, actionSecret: Deno.env.get("ACTION_API_SECRET"), databaseConfigured: configured }));
}
