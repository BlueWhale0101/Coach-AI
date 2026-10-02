import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const refs = new URL("coach/plugin/coach-ai/skills/coach-ai/references/", root);
await mkdir(refs, { recursive: true });
let instructions = await readFile(new URL("GPTInstructions.md", root), "utf8");
instructions = instructions.replace("Custom GPT Operating Instructions", "Coach Plugin Operating Instructions")
  .replaceAll("GPT Actions", "Coach MCP tools")
  .replace(/Available Actions[\s\S]*?Authentication \/ Transport[\s\S]*?⸻/, `Available Tools\n\nThe six connected tools are:\n\nadd_log_entry\nget_logs\nsearch_events\nupdate_event\nget_day_summary\nget_trends\n\nIf unavailable, do not claim database access or saving. Authentication stays on the private server.\n\n⸻`);
for (const [oldName, newName] of Object.entries({ addLogEntry: "add_log_entry", getLogs: "get_logs", searchEvents: "search_events", updateEvent: "update_event", getDaySummary: "get_day_summary", getTrends: "get_trends" })) instructions = instructions.replaceAll(oldName, newName);
instructions = instructions.replace("* retry only if the fix is obvious", "* never blindly retry an uncertain write; retrieve stored logs first")
  .replace("I didn’t save it. The likely issue is the date format.", "The date format may need correcting. If the outcome is uncertain, check stored logs before retrying.");
await writeFile(new URL("operating-instructions.md", refs), instructions);
await writeFile(new URL("data-semantics.md", refs), await readFile(new URL("DataSemantics.md", root), "utf8"));
console.log("Coach plugin references generated from canonical Coach documents.");
