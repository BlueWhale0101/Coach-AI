export const neutralCategory = { id: "uncategorized", label: "", color: "#5F6670" };

export const fixtureCategories = {
  family: { id: "family", label: "Family", color: "#FF7A59" },
  school: { id: "school", label: "School", color: "#5DD39E" },
  errands: { id: "errands", label: "Errands", color: "#F7C948" },
  home: { id: "home", label: "Home", color: "#7C9CFF" },
  work: { id: "work", label: "Work", color: "#B786FF" },
  health: { id: "health", label: "Health", color: "#FF6FAE" },
};

export const categories = fixtureCategories;

const DEFAULT_TIMEZONE = "Australia/Darwin";

function fixtureCategory(id) {
  return fixtureCategories[id] ?? neutralCategory;
}

function localDate(value, timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateLabel(date, timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T12:00:00Z`));
}

function timeLabel(value, timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function dueLabel(dueAt, now, timezone = DEFAULT_TIMEZONE) {
  if (!dueAt) return "";
  const dueDate = localDate(dueAt, timezone);
  const today = localDate(now, timezone);
  const tomorrowInstant = new Date(new Date(`${today}T12:00:00Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const tomorrow = localDate(tomorrowInstant, "UTC");
  if (Date.parse(dueAt) < Date.parse(now)) return "OVERDUE";
  if (dueDate === today) return "TODAY";
  if (dueDate === tomorrow) return "TOMORROW";
  const days = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days > 0 && days < 7) {
    return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", weekday: "long" }).format(new Date(`${dueDate}T12:00:00Z`)).toUpperCase();
  }
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${dueDate}T12:00:00Z`)).toUpperCase();
}

function spanLabel(event) {
  if (!event.start_date || !event.end_date) return "";
  const endInclusive = new Date(`${event.end_date}T00:00:00Z`);
  endInclusive.setUTCDate(endInclusive.getUTCDate() - 1);
  const endDate = endInclusive.toISOString().slice(0, 10);
  const format = new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "short" });
  const start = format.format(new Date(`${event.start_date}T12:00:00Z`));
  const end = format.format(endInclusive);
  return event.start_date === endDate ? start : `${start}-${end}`;
}

function categoryFromProjection(category) {
  if (!category) return neutralCategory;
  return {
    id: category.object_id,
    label: category.name,
    color: category.color,
    status: category.status,
  };
}

export function normalizeProjectionBoard(board) {
  const timezone = board.metadata?.timezone ?? DEFAULT_TIMEZONE;
  const now = board.metadata?.now ?? new Date().toISOString();
  return {
    now,
    timezone,
    metadata: board.metadata ?? {},
    tasks: (board.tasks ?? []).map(task => ({
      id: task.object_id,
      object_id: task.object_id,
      title: task.title,
      deadlineLabel: dueLabel(task.due_at, now, timezone),
      due_at: task.due_at,
      not_before: task.not_before,
      category: categoryFromProjection(task.category),
      tags: (task.tags ?? []).map(tag => tag.name),
      pinned: Boolean(task.pinned),
      description: task.description ?? "",
      priority: task.priority,
      surface_reason: task.surface_reason,
    })),
    days: (board.days ?? []).map(day => ({
      id: day.id,
      label: day.id === "tomorrow" ? "Tomorrow" : "Today",
      date: day.date,
      dateLabel: dateLabel(day.date, timezone),
      isToday: day.id === "today",
      allDay: (day.all_day_events ?? []).map(event => ({
        id: event.object_id,
        object_id: event.object_id,
        title: event.title,
        category: categoryFromProjection(event.category),
        span: spanLabel(event),
        detail: event.description ?? "",
        pinned: Boolean(event.pinned),
      })),
      events: (day.timed_events ?? []).map(event => ({
        id: event.object_id,
        object_id: event.object_id,
        title: event.title,
        start: event.start_time ?? timeLabel(event.starts_at, timezone),
        end: event.end_time ?? timeLabel(event.ends_at, timezone),
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        category: categoryFromProjection(event.category),
        location: "",
        detail: event.description ?? "",
        pinned: Boolean(event.pinned),
      })),
    })),
  };
}

export function getFixtureBoardSnapshot() {
  return {
    now: "2026-09-27T10:38:00+09:30",
    timezone: DEFAULT_TIMEZONE,
    tasks: [
      { id: "task-preschool-form", object_id: "task-preschool-form", title: "Submit preschool reimbursement form", deadlineLabel: "TODAY", category: fixtureCategory("school"), tags: ["paperwork", "money"], pinned: true, description: "Attach the Six Little Ducks invoice and send before the office closes." },
      { id: "task-library-books", object_id: "task-library-books", title: "Return library books from Tor's room", deadlineLabel: "OVERDUE", category: fixtureCategory("family"), tags: ["errand"], pinned: false, description: "Treehouse books are on the small shelf near the bed." },
      { id: "task-bin-night", object_id: "task-bin-night", title: "Bins out after dinner", deadlineLabel: "", category: fixtureCategory("home"), tags: ["routine"], pinned: true, description: "Put recycling on top so it is easy to remember in the dark." },
      { id: "task-jenny", object_id: "task-jenny", title: "Pay Jenny and book next appointment", deadlineLabel: "FRIDAY", category: fixtureCategory("health"), tags: ["appointment"], pinned: true, description: "Check whether the next slot is better before or after school pickup." },
      { id: "task-work-badge", object_id: "task-work-badge", title: "Put work badge back in backpack", deadlineLabel: "", category: fixtureCategory("work"), tags: ["tomorrow"], pinned: false, description: "It is on the kitchen counter next to the charging cables." },
      { id: "task-milk", object_id: "task-milk", title: "Buy lactose-free milk and bananas", deadlineLabel: "", category: fixtureCategory("errands"), tags: ["shops"], pinned: false, description: "Worth doing with the post office run if the car is already out." },
      { id: "task-car-seat", object_id: "task-car-seat", title: "Move car seat back to Skye's car", deadlineLabel: "12 OCT", category: fixtureCategory("family"), tags: ["handoff"], pinned: false, description: "Check the anchor strap before leaving it for the week." },
      { id: "task-rent-email", object_id: "task-rent-email", title: "Reply to Susan about lease timing", deadlineLabel: "", category: fixtureCategory("home"), tags: ["housing"], pinned: false, description: "Keep the tone warm and mention the UK timing is still uncertain." },
      { id: "task-prescriptions", object_id: "task-prescriptions", title: "Check migraine prescription refills", deadlineLabel: "FRIDAY", category: fixtureCategory("health"), tags: ["Skye"], pinned: false, description: "Look at Nurtec and Ubrelvy counts before the weekend." },
      { id: "task-lunchbox", object_id: "task-lunchbox", title: "Wash lunchbox and set out school hat", deadlineLabel: "", category: fixtureCategory("school"), tags: ["morning"], pinned: false, description: "Put the hat by the front door so it is visible from the table." },
      { id: "task-package", object_id: "task-package", title: "Check APO package shelf at work", deadlineLabel: "", category: fixtureCategory("work"), tags: ["errand"], pinned: false, description: "Ask at the desk if nothing is on the shelf." },
      { id: "task-dog-chew", object_id: "task-dog-chew", title: "Put shoes and earbuds above dog height", deadlineLabel: "", category: fixtureCategory("home"), tags: ["foster dog"], pinned: false, description: "Use the laundry shelf until the chewing phase calms down." },
      { id: "task-spa", object_id: "task-spa", title: "Confirm Glen Ivy booking details", deadlineLabel: "12 OCT", category: fixtureCategory("family"), tags: ["travel"], pinned: false, description: "Check hotel dates and spa day timing." },
      { id: "task-gym", object_id: "task-gym", title: "Pack grips and knee sleeves for gym", deadlineLabel: "", category: fixtureCategory("health"), tags: ["training"], pinned: false, description: "Leave the bag near the front door tonight." },
    ],
    days: [
      {
        id: "today", label: "Today", date: "2026-09-27", dateLabel: "Sun 27 Sep", isToday: true,
        allDay: [
          { id: "ad-trip", object_id: "ad-trip", title: "Skye + Tor LA planning window", category: fixtureCategory("family"), span: "27-29 Sep" },
          { id: "ad-preschool", object_id: "ad-preschool", title: "Preschool form due", category: fixtureCategory("school"), span: "Today" },
          { id: "ad-more", object_id: "ad-more", title: "Dog training focus", category: fixtureCategory("home"), span: "Today" },
        ],
        events: [
          { id: "e-breakfast", object_id: "e-breakfast", title: "Breakfast and lunchbox reset", start: "07:10", end: "07:45", category: fixtureCategory("family"), location: "Kitchen", detail: "Keep it simple before the morning handoff." },
          { id: "e-school", object_id: "e-school", title: "Preschool drop-off", start: "08:20", end: "08:45", category: fixtureCategory("school"), location: "Six Little Ducks", detail: "Bring hat and water bottle." },
          { id: "e-standup", object_id: "e-standup", title: "Ops standup", start: "09:00", end: "09:35", category: fixtureCategory("work"), location: "Desk", detail: "Mention factory delivery risk." },
          { id: "e-call", object_id: "e-call", title: "Call electrician", start: "09:20", end: "09:50", category: fixtureCategory("home"), location: "Phone", detail: "Ask about panel timing and quote validity." },
          { id: "e-refill", object_id: "e-refill", title: "Pharmacy refill check", start: "10:00", end: "10:15", category: fixtureCategory("health"), location: "Phone", detail: "Short call; make sure it stays visible." },
          { id: "e-budget", object_id: "e-budget", title: "Budget look", start: "10:05", end: "11:00", category: fixtureCategory("home"), location: "Table", detail: "Backpay and lease uncertainty notes." },
          { id: "e-skye", object_id: "e-skye", title: "Skye admin block", start: "10:10", end: "10:45", category: fixtureCategory("health"), location: "Kitchen", detail: "Migraine refills and appointment timing." },
          { id: "e-lunch", object_id: "e-lunch", title: "Lunch / reset kitchen", start: "12:10", end: "12:45", category: fixtureCategory("family"), location: "Home", detail: "Keep dishes from becoming an evening tax." },
          { id: "e-package", object_id: "e-package", title: "Post office window", start: "14:00", end: "14:40", category: fixtureCategory("errands"), location: "APO", detail: "Check if the package shelf has anything under either name." },
          { id: "e-gym", object_id: "e-gym", title: "CrossFit", start: "17:15", end: "18:15", category: fixtureCategory("health"), location: "Gym", detail: "Pack grips and sleeves before leaving." },
        ],
      },
      {
        id: "tomorrow", label: "Tomorrow", date: "2026-09-28", dateLabel: "Mon 28 Sep", isToday: false,
        allDay: [
          { id: "ad-roster", object_id: "ad-roster", title: "School roster note", category: fixtureCategory("school"), span: "Tomorrow" },
          { id: "ad-rent", object_id: "ad-rent", title: "Lease reply window", category: fixtureCategory("home"), span: "28-29 Sep" },
        ],
        events: [
          { id: "tm-school", object_id: "tm-school", title: "Drop-off", start: "08:20", end: "08:45", category: fixtureCategory("school"), location: "Preschool", detail: "Water bottle and hat." },
          { id: "tm-brief", object_id: "tm-brief", title: "Morning brief", start: "09:00", end: "09:25", category: fixtureCategory("work"), location: "Desk", detail: "Prep two talking points." },
          { id: "tm-drive", object_id: "tm-drive", title: "Errands loop", start: "09:15", end: "10:00", category: fixtureCategory("errands"), location: "Town", detail: "Milk, bananas, post office if needed." },
          { id: "tm-call", object_id: "tm-call", title: "Harrogate notes", start: "11:30", end: "12:15", category: fixtureCategory("work"), location: "Desk", detail: "List questions while the decision is still fresh." },
          { id: "tm-quiet", object_id: "tm-quiet", title: "Quiet reset", start: "13:30", end: "13:45", category: fixtureCategory("health"), location: "Home", detail: "Short break; do not let it disappear." },
          { id: "tm-pickup", object_id: "tm-pickup", title: "Pickup", start: "14:35", end: "15:00", category: fixtureCategory("school"), location: "Preschool", detail: "Ask about reimbursement receipt." },
        ],
      },
    ],
  };
}

export function isFixtureMode() {
  return new URLSearchParams(globalThis.location?.search ?? "").get("fixtures") === "1";
}

async function postApi(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error || "The board could not reach Assistant.AI.";
    const error = new Error(message);
    error.code = payload?.code || "API_ERROR";
    error.status = response.status;
    throw error;
  }
  return payload.data;
}

export async function getBoardSnapshot() {
  if (isFixtureMode()) return getFixtureBoardSnapshot();
  const data = await postApi("/api/household-board", { timezone: DEFAULT_TIMEZONE, task_limit: 15 });
  return normalizeProjectionBoard(data.board);
}

export async function completeTask(objectId) {
  if (isFixtureMode()) return { task: { object_id: objectId, status: "completed" } };
  return postApi("/api/complete-task", { object_id: objectId });
}

export async function pinObject(objectId) {
  if (isFixtureMode()) return { pin: { target_object_id: objectId, pinned: true, pinned_at: new Date().toISOString() } };
  return postApi("/api/pin-object", { target_object_id: objectId });
}

export async function unpinObject(objectId) {
  if (isFixtureMode()) return { pin: { target_object_id: objectId, pinned: false, pinned_at: null } };
  return postApi("/api/unpin-object", { target_object_id: objectId });
}
