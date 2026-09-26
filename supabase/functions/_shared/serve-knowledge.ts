import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createKnowledgeHandler } from "./knowledge-api.mjs";
import { SupabaseKnowledgeRepository } from "./supabase-knowledge-repository.mjs";

export function serveKnowledgeOperation(operation: string) {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const configured = Boolean(url && key);
  const client = configured ? createClient(url, key, { auth: { persistSession: false } }) : null;
  serve(createKnowledgeHandler({
    operation,
    repository: client ? new SupabaseKnowledgeRepository(client) : null,
    actionSecret: Deno.env.get("ACTION_API_SECRET"),
    databaseConfigured: configured,
  }));
}
