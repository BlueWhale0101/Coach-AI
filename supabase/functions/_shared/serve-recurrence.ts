import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createRecurrenceHandler } from "./recurrence-api.mjs";
import { SupabaseRecurrenceRepository } from "./supabase-recurrence-repository.mjs";

export function serveRecurrenceOperation(operation: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const configured = Boolean(url && key);
  const client = configured ? createClient(url, key, { auth: { persistSession: false } }) : null;
  serve(createRecurrenceHandler({ operation, repository: client ? new SupabaseRecurrenceRepository(client) : null, actionSecret: Deno.env.get("ACTION_API_SECRET"), databaseConfigured: configured }));
}
