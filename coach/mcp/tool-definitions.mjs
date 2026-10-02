import { readFileSync } from "node:fs";
import { z } from "zod";

// The existing Custom GPT contract remains authoritative. Resolve its local
// references rather than maintaining another copy of the event vocabulary.
const actions = JSON.parse(readFileSync(new URL("../../actions.yaml", import.meta.url), "utf8"));
function resolve(schema) {
  if (Array.isArray(schema)) return schema.map(resolve);
  if (!schema || typeof schema !== "object") return schema;
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "");
    if (!actions.components.schemas[name]) throw new Error("Unknown Coach action schema");
    return resolve(actions.components.schemas[name]);
  }
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [key, resolve(value)]));
}

const descriptions = {
  add_log_entry: "Save one new fitness log with the user's exact raw_text and extracted events. Separate facts from estimates. Planning is not completion. Use source gpt_action for conversational logs. Never retry an uncertain write blindly; retrieve logs first.",
  get_logs: "Recall raw logs and extracted events for an inclusive local-date range. Use before corrections if the event identity is unknown. Follow has_more with offset pagination.",
  search_events: "Find fitness events by text, type, review state, or local dates. Use to resolve stable event_id before correcting a record. Follow has_more with pagination.",
  update_event: "Correct a known fitness event by event_id; never change the original raw log. facts, estimates and interpretations merge supplied keys into existing objects. Retrieve the target first when uncertain.",
  get_day_summary: "Retrieve a mechanical daily summary. generate_if_missing defaults true and actually regenerates/upserts the summary; false only reads an existing summary. Detailed raw logs remain authoritative.",
  get_trends: "Retrieve trend data for weight, nutrition, workouts or recovery across local dates. Nutrition/workout/training-load metrics regenerate derived daily summaries; maximum 120 days for those metrics. Follow has_more; sparse logs do not prove complete intake or training.",
};

export const TOOL_DEFINITIONS = Object.entries(actions.paths).map(([path, operation]) => {
  const name = path.slice(1).replaceAll("-", "_");
  if (!descriptions[name]) throw new Error("Unmapped Coach action");
  const inputSchema = resolve(operation.post.requestBody.content["application/json"].schema);
  return {
    name, functionName: path.slice(1), description: descriptions[name], inputSchema,
    schema: z.fromJSONSchema(inputSchema),
    annotations: {
      readOnlyHint: ["get_logs", "search_events"].includes(name),
      destructiveHint: name === "update_event",
      idempotentHint: name !== "add_log_entry",
      openWorldHint: false,
    },
  };
});
export const TOOL_NAMES = TOOL_DEFINITIONS.map(tool => tool.name);
