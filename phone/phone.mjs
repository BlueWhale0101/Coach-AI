import {
  archiveKnowledge, cancelTask, completeTask, dateLabel, dueLabel,
  getPhoneTodaySnapshot, listCategories, listKnowledgeView, listTags, listTaskView,
  listWeekEvents, pinObject, unpinObject, updateKnowledge, updateTask,
} from "../tablet-board/data-provider.mjs";
import { StagedMutationController } from "../tablet-board/mutation-staging.mjs";
import { node } from "./dom.mjs";
import { createPhoneLoader } from "./load-view.mjs";
import { agendaForDay, attentionTasks, DESTINATIONS, phonePath, phoneRoute, shiftDay, taskActions, todayKey, upcomingEvents } from "./view-model.mjs";
import { createPhoneProjectionStore } from "./cache.mjs";
import { deviceZone, validZone } from "../tablet-board/view-helpers.mjs";
import { provisionalToday, cachedEvents, cachedTasks, refreshPhoneProjection } from "./local-projection.mjs";

const root = document.querySelector("#phone-root");
const nav = document.querySelector("#phone-nav");
const strip = document.querySelector("#phone-undo");
const staging = new StagedMutationController();
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const TODAY_TASK_LIMIT = 6;
const zoneKey = "assistant.phone.displayZone";
function resolveZone() {
  let manual;
  try { manual = localStorage.getItem(zoneKey); } catch {}
  return validZone(manual) ? manual : deviceZone();
}
let zone = resolveZone();
let generation = 0;
const currentDay = () => todayKey(new Date(), zone);
function checkZone() {
  const next = resolveZone();
  if (next === zone && state.referenceDay === currentDay()) return;
  zone = next;
  generation++; state.request++; state.syncing = false;
  state.day = state.referenceDay = currentDay();
  state.snapshot = null; state.items = [];
  showRoute(); load();
}
function chooseZone() {
  let saved = "";
  try { saved = localStorage.getItem(zoneKey) || ""; } catch {}
  const input = prompt("Display time zone (IANA name). Leave blank to follow device.", saved);
  if (input === null) return;
  const value = input.trim();
  if (value && !validZone(value)) return alert("Use a zone such as America/Los_Angeles.");
  try { localStorage.setItem(zoneKey, value); } catch { return alert("Could not save this display preference."); }
  checkZone();
}
const state = {
  route: phoneRoute(location.pathname), day: currentDay(), referenceDay: currentDay(), items: [], snapshot: null,
  categories: [], tags: [], tag: "", query: { tasks: "", knowledge: "" }, status: "open",
  category: { tasks: "", knowledge: "" }, expanded: null, pending: null,
  request: 0, searchTimer: null, cache: null, syncing: false, syncStatus: "",
};
const projectionStore = createPhoneProjectionStore();

function button(label, action, className = "") {
  const element = node("button", className, label);
  element.type = "button";
  element.addEventListener("click", action);
  return element;
}
function categoryColor(item) {
  const color = item.category?.color ?? "#5F6670";
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#5F6670";
}
function colorize(element, item) { element.style.setProperty("--category", categoryColor(item)); }
function message(text, undo = null, error = false) {
  strip.replaceChildren(node("span", "", text));
  strip.classList.toggle("error", error);
  strip.hidden = false;
  if (undo) strip.append(button("Undo", undo, "undo-button"));
  if (!undo) setTimeout(() => { if (!state.pending) strip.hidden = true; }, 3500);
}
function stage({ item, text, mutate, commit }) {
  const before = { ...item };
  const mutation = { item, before };
  staging.stage({
    restore: mutation,
    commit,
    onUndo: () => { Object.assign(item, before); if (state.route === "today") load(); else renderResults(); },
    onCommit: () => {
      if (state.pending === mutation) { state.pending = null; strip.hidden = true; refreshProjection({ force: true }); }
    },
    onFailure: () => {
      if (state.pending === mutation) state.pending = null;
      load();
      message("Change was not saved. Please try again.", null, true);
    },
  });
  state.pending = mutation;
  mutate();
  renderResults();
  message(text, () => {
    if (state.pending !== mutation) return;
    staging.undo();
    state.pending = null;
    strip.hidden = true;
  });
}
function complete(item) {
  if (item.status !== "open") return;
  stage({ item, text: "Task completed", mutate: () => { item.status = "completed"; }, commit: () => completeTask(item.object_id) });
}
function cancel(item) {
  if (item.status !== "open") return;
  stage({ item, text: "Task cancelled", mutate: () => { item.status = "cancelled"; }, commit: () => cancelTask(item.object_id) });
}
function pin(item) {
  const wasPinned = item.pinned;
  stage({ item, text: wasPinned ? "Unpinned" : "Pinned", mutate: () => { item.pinned = !wasPinned; },
    commit: () => wasPinned ? unpinObject(item.object_id) : pinObject(item.object_id) });
}
function archive(item) {
  if (item.status !== "active") return;
  stage({ item, text: "Knowledge archived", mutate: () => { item.status = "archived"; }, commit: () => archiveKnowledge(item.object_id) });
}
async function edit(item, type) {
  const title = prompt(`${type} title`, item.title);
  if (title === null) return;
  const field = type === "Task" ? "description" : "content";
  const detail = prompt(`${type} ${field}`, item[field] ?? "");
  if (detail === null) return;
  try {
    if (type === "Task") await updateTask(item.object_id, { title, description: detail || null });
    else await updateKnowledge(item.object_id, { title, content: detail });
    Object.assign(item, { title, [field]: detail });
    renderResults();
    message(`${type} saved`);
  } catch { message(`${type} was not saved. Please try again.`, null, true); }
}
function heading(title, caption) {
  const header = node("header", "page-header");
  header.append(node("p", "eyebrow", caption), node("h1", "", title));
  // Keep this slot in the layout so a sync update never nudges the view down.
  header.appendChild(node("p", "sync-status", state.syncStatus));
  return header;
}
function section(title, count) {
  const element = node("section", "section");
  element.appendChild(node("h2", "section-title", count === undefined ? title : `${title} · ${count}`));
  return element;
}
function empty(text) { return node("p", "empty", text); }
function detailCard(item, type) {
  const card = node("article", "card");
  colorize(card, item);
  const main = button("", () => { state.expanded = state.expanded === item.id ? null : item.id; renderResults(); }, "card-main");
  main.setAttribute("aria-expanded", String(state.expanded === item.id));
  main.appendChild(node("span", "category-dot"));
  const copy = node("span", "card-copy");
  copy.appendChild(node("strong", "card-title", item.title));
  const meta = [];
  if (type === "task") {
    if (item.pinned) meta.push("Pinned");
    if (item.deadlineLabel) meta.push(item.deadlineLabel);
    if (item.due_at) meta.push(`Due ${new Intl.DateTimeFormat("en-AU", { timeZone: zone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(item.due_at))}`);
    if (item.status !== "open") meta.push(item.status);
  } else {
    if (item.pinned) meta.push("Pinned");
    if (item.category?.label) meta.push(item.category.label);
    if (item.tags?.length) meta.push(item.tags.join(" · "));
  }
  if (meta.length) copy.appendChild(node("small", "card-meta", meta.join(" · ")));
  main.appendChild(copy);
  main.appendChild(node("span", "chevron", state.expanded === item.id ? "−" : "+"));
  card.appendChild(main);
  if (state.expanded === item.id) {
    const details = node("div", "card-details");
    const content = type === "task" ? item.description : item.content;
    if (content) details.appendChild(node("p", "detail-text", content));
    if (type === "task" && item.tags?.length) details.appendChild(node("p", "card-meta", `Tags: ${item.tags.join(" · ")}`));
    const actions = node("div", "actions");
    if (type === "task") {
      const allowed = taskActions(item);
      if (allowed.includes("complete")) actions.append(button("Complete", () => complete(item), "primary"));
      if (allowed.includes("pin")) actions.append(button(item.pinned ? "Unpin" : "Pin", () => pin(item)));
      if (allowed.includes("edit")) actions.append(button("Edit", () => edit(item, "Task")));
      if (allowed.includes("cancel")) actions.append(button("Cancel", () => cancel(item), "quiet"));
    } else {
      actions.append(button(item.pinned ? "Unpin" : "Pin", () => pin(item)));
      if (item.status === "active") {
        actions.append(button("Edit", () => edit(item, "Knowledge")));
        actions.append(button("Archive", () => archive(item), "quiet"));
      }
    }
    details.appendChild(actions);
    card.appendChild(details);
  }
  return card;
}
function eventCard(event, allDay = false) {
  const card = node("details", "card event-card");
  colorize(card, event);
  const summary = node("summary", "event-summary");
  summary.appendChild(node("span", "event-time", allDay ? "All day" : `${event.start}–${event.end}`));
  summary.appendChild(node("span", "category-dot"));
  summary.appendChild(node("strong", "", event.title));
  card.appendChild(summary);
  if (event.detail) card.appendChild(node("p", "detail-text", event.detail));
  return card;
}
function renderResults() {
  const results = document.querySelector("#phone-results");
  if (!results) return;
  results.replaceChildren();
  if (state.route === "today") {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    const tasks = attentionTasks(snapshot)
      .filter(item => item.status !== "completed" && item.status !== "cancelled")
      .slice(0, TODAY_TASK_LIMIT);
    const taskSection = section("Needs attention", tasks.length);
    taskSection.append(...(tasks.length ? tasks.map(item => detailCard(item, "task")) : [empty(snapshot.provisional ? "Refresh to see tasks for this day." : "Nothing pressing right now.")]));
    results.appendChild(taskSection);
    const today = snapshot.days[0];
    const schedule = section("Today's schedule");
    schedule.append(...today.allDay.map(event => eventCard(event, true)), ...today.events.map(event => eventCard(event)));
    if (!today.allDay.length && !today.events.length) schedule.append(empty(snapshot.provisional ? "No saved events for this day." : "No events today."));
    results.appendChild(schedule);
    const next = upcomingEvents(snapshot.days, snapshot.now);
    if (next.length) {
      const upcoming = section("Coming up");
      for (const event of next) {
        const wrapper = node("div", "upcoming-row");
        wrapper.append(node("small", "card-meta", dateLabel(event.day)), eventCard(event, event.allDay));
        upcoming.appendChild(wrapper);
      }
      results.appendChild(upcoming);
    }
  } else if (state.route === "calendar") {
    const { allDay, timed } = agendaForDay(state.items, state.day);
    if (allDay.length) { const group = section("All day"); group.append(...allDay.map(item => eventCard(item, true))); results.appendChild(group); }
    const group = section("Schedule", timed.length);
    group.append(...(timed.length ? timed.map(item => eventCard(item)) : [empty("No timed events on this day.")]));
    results.appendChild(group);
  } else {
    const type = state.route === "tasks" ? "task" : "knowledge";
    const items = state.items.filter(item => {
      if (type === "task") return state.status === "all" || item.status === state.status;
      return item.status === "active";
    });
    results.append(...(items.length ? items.map(item => detailCard(item, type)) : [empty("No matching items.")]));
  }
}
function filterSelect(label, choices, value, change) {
  const wrap = node("label", "filter-label");
  wrap.appendChild(node("span", "sr-only", label));
  const select = node("select", "filter-select");
  select.setAttribute("aria-label", label);
  for (const [id, name] of choices) {
    const option = node("option", "", name);
    option.value = id;
    select.appendChild(option);
  }
  select.value = value;
  select.addEventListener("change", () => change(select.value));
  wrap.appendChild(select);
  return wrap;
}
function searchControls(route) {
  const controls = node("div", "controls");
  const search = node("input", "search-input");
  search.type = "search";
  search.placeholder = route === "knowledge" ? "Search knowledge" : "Search tasks";
  search.setAttribute("aria-label", search.placeholder);
  search.value = state.query[route];
  search.addEventListener("input", () => {
    state.query[route] = search.value;
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => load(), 260);
  });
  controls.appendChild(search);
  const filters = node("div", "filter-row");
  if (route === "tasks") filters.append(filterSelect("Task status", [["open", "Open"], ["completed", "Completed"], ["cancelled", "Cancelled"], ["all", "All"]], state.status, value => { state.status = value; load(); }));
  filters.append(filterSelect("Category", [["", "All categories"], ...state.categories.map(item => [item.object_id, item.name])], state.category[route], value => { state.category[route] = value; load(); }));
  controls.appendChild(filters);
  if (route === "tasks") {
    const tagFilter = node("div", "filter-row");
    tagFilter.append(filterSelect("Tag", [["", "All tags"], ...state.tags.map(item => [item.object_id, item.name])], state.tag, value => { state.tag = value; load(); }));
    controls.appendChild(tagFilter);
  }
  return controls;
}
function showRoute() {
  root.replaceChildren();
  const title = { today: "Today", tasks: "Tasks", calendar: "Calendar", knowledge: "Knowledge" }[state.route];
  root.appendChild(heading(title, state.route === "today" ? dateLabel(currentDay()) : "ASSISTANT.AI"));
  root.querySelector(".page-header")?.append(button(zone, chooseZone));
  if (state.route === "tasks" || state.route === "knowledge") root.appendChild(searchControls(state.route));
  if (state.route === "calendar") {
    const controls = node("div", "date-nav");
    controls.append(button("‹ Previous", () => navigateDay(-1)));
    controls.append(button("Today", () => { state.day = currentDay(); showRoute(); load(); }));
    controls.append(button("Next ›", () => navigateDay(1)));
    root.append(controls, node("h2", "agenda-date", dateLabel(state.day)));
  }
  const results = node("div", "results");
  results.id = "phone-results";
  root.appendChild(results);
  renderResults();
  nav.replaceChildren();
  for (const route of DESTINATIONS) {
    const tab = button(route[0].toUpperCase() + route.slice(1), () => navigate(route), route === state.route ? "active" : "");
    tab.setAttribute("aria-current", route === state.route ? "page" : "false");
    nav.appendChild(tab);
  }
}
function navigateDay(amount) { state.day = shiftDay(state.day, amount); showRoute(); load(); }
function navigate(route, push = true) {
  if (state.route === route) return;
  clearTimeout(state.searchTimer);
  state.route = route;
  state.expanded = null;
  state.items = [];
  if (push) history.pushState({}, "", `${phonePath(route)}${location.search}`);
  showRoute();
  load();
}
const networkLoad = createPhoneLoader({
  state,
  services: { getPhoneTodaySnapshot: () => getPhoneTodaySnapshot(zone), listTaskView: o => listTaskView({...o, timezone: zone}), listWeekEvents: o => listWeekEvents({...o, timezone: zone}), listKnowledgeView },
  getResults: () => document.querySelector("#phone-results"),
  renderResults,
  empty,
  shiftDay,
});
function setSyncStatus(value) {
  if (state.syncStatus === value) return;
  state.syncStatus = value;
  const existing = document.querySelector(".sync-status");
  if (existing) existing.textContent = value;
  else document.querySelector(".page-header")?.appendChild(node("p", "sync-status", value));
}
function adoptProjection(projection) {
  state.cache = projection;
  state.categories = projection.categories;
  state.tags = projection.tags;
}
function provisional(p) { return p.timezone !== zone || p.today.metadata?.today !== currentDay(); }
function renderCachedRoute() {
  const projection = state.cache;
  if (!projection) return false;
  if (state.route === "today") state.snapshot = provisional(projection) ? provisionalToday(projection, zone) : projection.today;
  else if (state.route === "tasks") {
    const tasks = cachedTasks(projection, { query: state.query.tasks, status: state.status, categoryId: state.category.tasks, tagId: state.tag });
    if (tasks === null) return false;
    state.items = tasks.map(task => ({ ...task, deadlineLabel: dueLabel(task.due_at, new Date(), zone) }));
  } else if (state.route === "calendar") {
    const events = cachedEvents(projection, state.day, zone);
    if (events === null) return false;
    state.items = events;
  } else return false; // Knowledge remains intentionally on-demand.
  renderResults();
  if (provisional(projection)) setSyncStatus("Cached events · coverage may be incomplete; Today’s tasks need refresh");
  return true;
}
async function refreshProjection({ force = false } = {}) {
  if (state.syncing) return;
  const version = generation;
  state.syncing = true;
  if (!force && !(state.cache && provisional(state.cache))) setSyncStatus("Updating…");
  try {
    const projection = await refreshPhoneProjection({
      services: { getPhoneTodaySnapshot, listTaskView, listCategories, listTags, listWeekEvents }, store: projectionStore, timezone: zone, current: () => generation === version,
    });
    if (!projection || version !== generation) return;
    adoptProjection(projection);
    setSyncStatus("");
    if (!state.pending) renderCachedRoute();
    syncFilterSelect("Category", state.categories, "All categories");
    syncFilterSelect("Tag", state.tags, "All tags");
  } catch {
    if (generation !== version) return;
    setSyncStatus(state.cache && provisional(state.cache) ? "Offline · partial events; Today’s tasks need refresh" : state.cache ? "Offline · cached" : "Offline");
  } finally { if (generation === version) state.syncing = false; }
}
async function load() {
  state.request++;
  if (renderCachedRoute()) { refreshProjection(); return; }
  await networkLoad();
  if (state.cache && provisional(state.cache)) refreshProjection();
}
function syncFilterSelect(label, items, allLabel) {
  const select = document.querySelector(`select[aria-label="${label}"]`);
  if (!select) return;
  const selected = select.value;
  select.replaceChildren();
  const all = node("option", "", allLabel);
  all.value = "";
  select.appendChild(all);
  for (const item of items) {
    const option = node("option", "", item.name);
    option.value = item.object_id;
    select.appendChild(option);
  }
  select.value = items.some(item => item.object_id === selected) ? selected : "";
}
async function refreshReferenceData() {
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  state.categories = categories;
  state.tags = tags;
  syncFilterSelect("Category", categories, "All categories");
  syncFilterSelect("Tag", tags, "All tags");
}
async function autoRefresh() {
  checkZone();
  if (state.pending) return;
  await Promise.allSettled([refreshProjection(), state.cache ? Promise.resolve() : refreshReferenceData()]);
}
window.addEventListener("popstate", () => navigate(phoneRoute(location.pathname), false));
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/phone/sw.js").catch(() => {});
async function boot() {
  const cached = await projectionStore.read();
  if (cached) adoptProjection(cached);
  showRoute();
  if (cached) {
    if (!renderCachedRoute()) networkLoad();
    if (!provisional(cached)) setSyncStatus("Cached");
    refreshProjection();
  } else {
    // Preserve the established first-run Today request, then build the fuller
    // bounded cache once that initial view is usable.
    networkLoad().finally(() => refreshProjection());
  }
}
window.addEventListener("focus", checkZone);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkZone(); });
window.addEventListener("online", autoRefresh);
boot();
setInterval(autoRefresh, AUTO_REFRESH_MS);
