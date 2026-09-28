const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const error = (code, status) => json({ ok: false, code }, status);
const dateInDarwin = instant => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Darwin", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(instant));

export function compactWidgetToday(board) {
  const metadata = board.metadata;
  const today = metadata.today;
  const now = Date.parse(metadata.now);
  const tasks = board.tasks.filter(task => task.pinned || task.surface_reason === "overdue" ||
    (task.due_at && dateInDarwin(task.due_at) === today) || task.surface_reason === "actionable")
    .slice(0, 6).map(task => ({
      object_id: task.object_id, title: task.title, due_at: task.due_at,
      surface_reason: task.surface_reason, pinned: task.pinned,
      category: task.category && { name: task.category.name, color: task.category.color },
      url: "/phone/tasks",
    }));
  const seen = new Set();
  const events = (board.days ?? []).flatMap(day => [
    ...day.all_day_events.map(event => ({ event, date: day.date, all_day: true })),
    ...day.timed_events.map(event => ({ event, date: day.date, all_day: false })),
  ]).filter(({ event, date, all_day }) => date >= today && (all_day || Date.parse(event.ends_at) > now))
    .sort((a, b) => (a.date.localeCompare(b.date) ||
      (a.all_day ? 0 : Date.parse(a.event.starts_at)) - (b.all_day ? 0 : Date.parse(b.event.starts_at))))
    .filter(({ event }) => { if (seen.has(event.object_id)) return false; seen.add(event.object_id); return true; })
    .slice(0, 3).map(({ event, date, all_day }) => ({
      object_id: event.object_id, title: event.title, date, all_day,
      ...(all_day ? {} : { starts_at: event.starts_at, ends_at: event.ends_at }),
      category: event.category && { name: event.category.name, color: event.category.color },
      url: "/phone/calendar",
    }));
  return { date: today, timezone: "Australia/Darwin", generated_at: metadata.generated_at,
    tasks, events, url: "/phone/" };
}

export function createWidgetTodayHandler({ repository, credentials, actionSecret, configured = true, clock = () => new Date() }) {
  return async request => {
    if (request.method !== "GET") return error("METHOD_NOT_ALLOWED", 405);
    if (!configured || !actionSecret) return error("SERVER_CONFIG_ERROR", 503);
    if (request.headers.get("x-action-secret") !== actionSecret) return error("UNAUTHORIZED", 401);
    const url = new URL(request.url);
    if (url.search) return error("INVALID_REQUEST", 400);
    const match = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get("authorization") ?? "");
    if (!match) return error("UNAUTHORIZED", 401);
    try {
      const bytes = new TextEncoder().encode(match[1]);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      const credential = await credentials.find(hash);
      const now = clock();
      if (!credential || credential.revoked_at || credential.scope !== "widget:today:read" ||
          (credential.expires_at && Date.parse(credential.expires_at) <= now.getTime())) return error("UNAUTHORIZED", 401);
      const board = await repository.getPhoneToday({ display_date: null, timezone: "Australia/Darwin", now: now.toISOString(), task_limit: 30 });
      return json({ ok: true, data: compactWidgetToday(board) });
    } catch {
      return error("SERVICE_UNAVAILABLE", 503);
    }
  };
}
