import { normalizeToolError } from "./edge-client.mjs";
import { TOOL_NAMES } from "./tool-definitions.mjs";

const SEARCH_TOOLS = new Set(["find_tasks", "find_knowledge", "find_events"]);

function compact(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([, v]) => v !== undefined));
}

function hasQuery(args) {
  return typeof args.query === "string" && args.query.trim() !== "";
}

function byLowerName(items, name) {
  const wanted = name.trim().toLocaleLowerCase();
  return items.find((item) => item.name.toLocaleLowerCase() === wanted);
}

async function listAll(edge, functionName, resultKey) {
  const rows = [];
  for (let offset = 0; offset <= 10000; offset += 100) {
    const data = await edge.call(functionName, { status: "active", limit: 100, offset });
    rows.push(...(data[resultKey] || []));
    if (!data.has_more) return rows;
  }
  return rows;
}

function success(data, summary) {
  return { ok: true, summary, ...data };
}

function unsupportedIfSearchAndWindow(toolName, args) {
  if (toolName === "find_events" && hasQuery(args)) {
    const overlapFields = ["timed_overlap_start", "timed_overlap_end", "all_day_overlap_start", "all_day_overlap_end"];
    if (overlapFields.some((field) => args[field] !== undefined)) {
      return {
        ok: false,
        code: "UNSUPPORTED_COMBINATION",
        error: "find_events cannot combine text search with calendar overlap filters in Scheduling V0",
        details: { use: "Search text first or browse by time window, then resolve with get_event." },
      };
    }
  }
  return null;
}

export async function callAssistantTool(edge, toolName, args = {}) {
  if (!TOOL_NAMES.includes(toolName)) {
    return { ok: false, code: "UNKNOWN_TOOL", error: `Unknown Assistant.AI MCP tool: ${toolName}`, details: {} };
  }

  const unsupported = unsupportedIfSearchAndWindow(toolName, args);
  if (unsupported) return unsupported;

  try {
    if (toolName === "find_tasks") {
      const data = await edge.call(hasQuery(args) ? "search-tasks" : "list-tasks", compact(args));
      return success(data, `${data.count ?? data.tasks?.length ?? 0} task(s) returned`);
    }
    if (toolName === "get_task") return success(await edge.call("get-task", args), "Task retrieved");
    if (toolName === "create_task") return success(await edge.call("create-task", args), "Task created");
    if (toolName === "update_task") return success(await edge.call("update-task", args), "Task updated");
    if (toolName === "complete_task") return success(await edge.call("complete-task", args), "Task completed");
    if (toolName === "cancel_task") return success(await edge.call("cancel-task", args), "Task cancelled");

    if (toolName === "find_knowledge") {
      const data = await edge.call(hasQuery(args) ? "search-knowledge" : "list-knowledge", compact(args));
      return success(data, `${data.count ?? data.knowledge?.length ?? 0} knowledge item(s) returned`);
    }
    if (toolName === "get_knowledge") return success(await edge.call("get-knowledge", args), "Knowledge retrieved");
    if (toolName === "remember") return success(await edge.call("create-knowledge", args), "Knowledge remembered");
    if (toolName === "update_knowledge") return success(await edge.call("update-knowledge", args), "Knowledge updated");
    if (toolName === "archive_knowledge") return success(await edge.call("archive-knowledge", args), "Knowledge archived");

    if (toolName === "find_events") {
      const data = await edge.call(hasQuery(args) ? "search-schedule-events" : "list-schedule-events", compact(args));
      return success(data, `${data.count ?? data.events?.length ?? 0} event(s) returned`);
    }
    if (toolName === "get_event") return success(await edge.call("get-schedule-event", args), "Event retrieved");
    if (toolName === "create_event") return success(await edge.call("create-schedule-event", args), "Event created");
    if (toolName === "update_event") return success(await edge.call("update-schedule-event", args), "Event updated");
    if (toolName === "cancel_event") return success(await edge.call("cancel-schedule-event", args), "Event cancelled");

    if (toolName === "set_reminder") return success(await edge.call("create-reminder", args), "Reminder set");
    if (toolName === "set_recurrence") return success(await edge.call("create-recurrence", args), "Recurrence set");
    if (toolName === "update_recurrence") return success(await edge.call("update-recurrence", args), "Recurrence updated");
    if (toolName === "end_recurrence") return success(await edge.call("end-recurrence", args), "Recurrence ended");

    if (toolName === "set_category") return await setCategory(edge, args);
    if (toolName === "set_tags") return await setTags(edge, args);

    if (toolName === "pin") return success(await edge.call("pin-object", { target_object_id: args.object_id }), "Object pinned");
    if (toolName === "unpin") return success(await edge.call("unpin-object", { target_object_id: args.object_id }), "Object unpinned");
    if (toolName === "get_household_board") return success(await edge.call("get-household-board", compact(args)), "Household board retrieved");
  } catch (error) {
    return normalizeToolError(error);
  }
}

async function setCategory(edge, args) {
  if (args.category_name === null) {
    return success(await edge.call("clear-object-category", { target_object_id: args.object_id }), "Category cleared");
  }

  const categories = await listAll(edge, "list-categories", "categories");
  const category = typeof args.category_name === "string" ? byLowerName(categories, args.category_name) : null;
  if (!category) {
    return {
      ok: false,
      code: "UNKNOWN_CATEGORY",
      error: `No active category named ${JSON.stringify(args.category_name)} exists`,
      details: { available_categories: categories.map(({ object_id, name, color, sort_order }) => ({ object_id, name, color, sort_order })) },
    };
  }

  return success(
    await edge.call("set-object-category", { target_object_id: args.object_id, category_object_id: category.object_id }),
    `Category set to ${category.name}`,
  );
}

async function setTags(edge, args) {
  const desiredNames = Array.from(new Set((args.tags || []).map((tag) => String(tag).trim()).filter(Boolean)));
  const available = await listAll(edge, "list-tags", "tags");
  const desired = desiredNames.map((name) => ({ name, tag: byLowerName(available, name) }));
  const unknown = desired.filter((entry) => !entry.tag).map((entry) => entry.name);
  if (unknown.length) {
    return {
      ok: false,
      code: "UNKNOWN_TAG",
      error: "One or more requested tags do not exist; no tag changes were applied",
      details: {
        unknown_tags: unknown,
        available_tags: available.map(({ object_id, name }) => ({ object_id, name })),
      },
    };
  }

  return success(
    await edge.call("replace-object-tags", {
      target_object_id: args.object_id,
      tag_object_ids: desired.map((entry) => entry.tag.object_id),
    }),
    `Tags replaced with ${desiredNames.join(", ") || "no tags"}`,
  );
}

export function expectedToolSequenceByBehavioralFixture() {
  return [
    { case: 1, prompt: "Add do the dishes.", expected_tools: ["create_task"], notes: "No due date invented." },
    { case: 2, prompt: "Actually make that every night.", expected_tools: ["set_recurrence"], notes: "Use prior task identity; no duplicate task." },
    { case: 3, prompt: "Remember that Susan said we need 30 days notice if we move.", expected_tools: ["remember"], notes: "Knowledge, not Task." },
    { case: 4, prompt: "Remind me Wednesday morning to call the electrician.", expected_tools: ["create_task", "set_reminder"], notes: "No fake Wednesday due date." },
    { case: 5, prompt: "The application is due Friday. Remind me Wednesday.", expected_tools: ["create_task", "set_reminder"], notes: "Friday due_at; Wednesday reminder." },
    { case: 6, prompt: "Keep the electrician thing on the board.", expected_tools: ["find_tasks", "pin"], notes: "Resolve identity before pinning." },
    { case: 7, prompt: "Cancel the electrician thing.", expected_tools: ["find_tasks", "cancel_task"], notes: "Clarify instead of mutating when multiple plausible matches remain." },
    { case: 8, prompt: "What do I have tomorrow?", expected_tools: ["find_events"], notes: "Read-only calendar lookup." },
    { case: 9, prompt: "Tor has swimming Tuesday from 10 to 11.", expected_tools: ["create_event"], notes: "Event, not Task." },
    { case: 10, prompt: "Make swimming weekly.", expected_tools: ["set_recurrence"], notes: "Use existing event identity." },
    { case: 11, prompt: "Remember to call Susan.", expected_tools: ["create_task"], notes: "Actionable commitment." },
    { case: 12, prompt: "Put this under Home.", expected_tools: ["set_category"], notes: "Existing category only." },
    { case: 13, prompt: "Tag this moving and house.", expected_tools: ["set_tags"], notes: "Existing tags only; no partial mutation." },
    { case: 14, prompt: "Move the electrician appointment to Thursday afternoon.", expected_tools: ["find_events", "update_event"], notes: "Resolve event and supply complete time representation." },
    { case: 15, prompt: "Delete/cancel that thing.", expected_tools: ["find_tasks", "find_events"], notes: "Clarify when identity/type is insufficient; no terminal mutation until resolved." },
  ];
}
