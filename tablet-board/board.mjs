import {
  archiveKnowledge as persistArchiveKnowledge,
  cancelTask as persistCancelTask,
  completeTask as persistCompleteTask,
  DEFAULT_TIMEZONE,
  getBoardSnapshot,
  listCategories,
  listKnowledgeView,
  listTags,
  listTaskView,
  listWeekEvents,
  neutralCategory,
  pinObject,
  unpinObject,
  updateKnowledge as persistUpdateKnowledge,
  updateTask as persistUpdateTask,
} from "./data-provider.mjs";
import { StagedMutationController } from "./mutation-staging.mjs";
import { DAY_END_MINUTE, PIXELS_PER_HOUR, formatTime, hourLabels, layoutTimedEvents, minutesToPixels, visibleAllDayItems } from "./calendar-layout.mjs";
import { VISIBLE_HOUR_OPTIONS, loadDisplaySettings, normalizeDisplaySettings, resetDisplaySettings, saveDisplaySettings, tintAlpha } from "./display-settings.mjs";
import { addDays, bindTaskDoubleTap, computePaneHourPixels, eventDateKey, isoDate, localDateKey, localTimeMinutes, pathForRoute, routeFromPath, startOfWeek, taskActionsForStatus, weekDays, weekRange } from "./view-helpers.mjs";

const STAGE_DELAY_MS = 5000;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const root = document.querySelector("#board-root");
const undoStrip = document.querySelector("#undo-strip");
const staging = new StagedMutationController({ delayMs: STAGE_DELAY_MS });
let searchTimer = null;
let viewRequest = 0;

const state = {
  route: routeFromPath(location.pathname),
  snapshot: null,
  viewItems: [],
  categories: [],
  tags: [],
  weekStart: startOfWeek(new Date()),
  loading: true,
  viewLoading: false,
  error: null,
  expandedTaskId: null,
  expandedItemId: null,
  selectedEventId: null,
  pendingMutation: null,
  displaySettings: loadDisplaySettings(),
  navOpen: false,
  settingsOpen: false,
  filters: {
    tasks: { query: "", status: "open", categoryId: "" },
    knowledge: { query: "", categoryId: "", tagName: "" },
  },
  measuredHourPixels: PIXELS_PER_HOUR,
};

const clone = value => structuredClone(value);
const categoryFor = item => item?.category ?? neutralCategory;

function tint(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyCategoryVars(element, item, alpha = 0.16) {
  const category = categoryFor(item);
  element.style.setProperty("--category", category.color);
  element.style.setProperty("--category-tint", tint(category.color, tintAlpha(state.displaySettings, alpha)));
}

function button(label, className = "ghost-button") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  return node;
}

function showMessage(message, { undo, error = false } = {}) {
  undoStrip.innerHTML = "";
  undoStrip.hidden = false;
  undoStrip.classList.toggle("error", error);
  const text = document.createElement("div");
  text.className = "undo-message";
  text.textContent = message;
  undoStrip.appendChild(text);
  if (undo) {
    const undoButton = button("UNDO", "undo-button");
    undoButton.addEventListener("click", undo);
    undoStrip.appendChild(undoButton);
  }
}

function hideStripSoon() {
  setTimeout(() => {
    if (!state.pendingMutation) undoStrip.hidden = true;
  }, 1600);
}

function currentPixelsPerHour() {
  return state.measuredHourPixels || PIXELS_PER_HOUR;
}

function applyDisplaySettings() {
  const settings = normalizeDisplaySettings(state.displaySettings);
  state.displaySettings = settings;
  root.style.setProperty("--task-pane-width", `${settings.taskSplitPercent}%`);
  root.style.setProperty("--text-scale", String(settings.textScale / 100));
  root.style.setProperty("--hour", `${currentPixelsPerHour()}px`);
  root.style.setProperty("--today-pane", `${settings.todayWidthPercent}fr`);
  root.style.setProperty("--tomorrow-pane", `${100 - settings.todayWidthPercent}fr`);
}

function restoreVisibleState(snapshot, route) {
  if (state.route !== route) return;
  if (route === "board") state.snapshot = snapshot;
  else state.viewItems = snapshot;
  state.expandedTaskId = null;
  state.expandedItemId = null;
  render();
}

function stageMutation({ message, restore, commit }) {
  const route = state.route;
  const mutation = { restore, route };
  staging.stage({
    restore,
    commit,
    onCommit: () => {
      if (state.pendingMutation === mutation) {
        state.pendingMutation = null;
        undoStrip.hidden = true;
      }
      if (state.route !== route && !state.pendingMutation) {
        if (state.route === "tasks") loadTaskView({ preserveControls: true });
        else if (state.route === "knowledge") loadKnowledgeView({ preserveControls: true });
        else loadCurrentView();
      }
    },
    onUndo: snapshot => restoreVisibleState(snapshot, route),
    onFailure: (snapshot) => {
      const latest = state.pendingMutation === mutation;
      if (latest) state.pendingMutation = null;
      // A later action or route change makes the old snapshot stale.
      if (state.route === route && latest) restoreVisibleState(snapshot, route);
      else loadCurrentView();
      showMessage("Change was not saved. Please try again.", { error: true });
      hideStripSoon();
    },
  });
  state.pendingMutation = mutation;
  showMessage(message, {
    undo: () => {
      if (state.pendingMutation === mutation) {
        staging.undo();
        state.pendingMutation = null;
        undoStrip.hidden = true;
      }
    },
  });
}

function updateDisplaySettings(patch, { renderBoard = true } = {}) {
  state.displaySettings = saveDisplaySettings({ ...state.displaySettings, ...patch });
  applyDisplaySettings();
  if (renderBoard) render();
}

function restoreDefaultDisplaySettings() {
  state.displaySettings = resetDisplaySettings();
  state.measuredHourPixels = PIXELS_PER_HOUR;
  render();
}

function formatHour(hour) {
  const wrapped = ((hour % 24) + 24) % 24;
  if (wrapped === 0) return "12 AM";
  if (wrapped === 12) return "12 PM";
  return wrapped > 12 ? `${wrapped - 12} PM` : `${wrapped} AM`;
}

function renderMenuButton() {
  const node = button("Menu", "menu-button");
  node.setAttribute("aria-expanded", String(state.navOpen));
  node.addEventListener("click", (event) => {
    event.stopPropagation();
    state.navOpen = !state.navOpen;
    state.settingsOpen = false;
    render();
  });
  return node;
}

function navigate(route) {
  state.route = route;
  state.navOpen = false;
  state.settingsOpen = false;
  history.pushState({}, "", pathForRoute(route));
  loadCurrentView();
}

function renderHeader(title, eyebrow = "ASSISTANT") {
  const header = document.createElement("div");
  header.className = "app-header";
  const titleGroup = document.createElement("div");
  titleGroup.className = "title-with-menu";
  titleGroup.appendChild(renderMenuButton());
  const copy = document.createElement("div");
  copy.innerHTML = `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1>`;
  titleGroup.appendChild(copy);
  header.appendChild(titleGroup);
  return header;
}

function taskActions(task, { includeCancel = false } = {}) {
  const actions = document.createElement("div");
  actions.className = "task-actions";
  const allowed = taskActionsForStatus(task.status);
  if (allowed.includes("complete")) {
    const complete = button("Complete", "solid-button");
    complete.addEventListener("click", (event) => {
      event.stopPropagation();
      completeTask(task);
    });
    actions.appendChild(complete);
  }
  if (allowed.includes("pin")) {
    const pin = button(task.pinned ? "Unpin" : "Pin");
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePin(task);
    });
    actions.appendChild(pin);
  }
  if (allowed.includes("edit")) {
    const edit = button("Edit");
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      editTask(task);
    });
    actions.appendChild(edit);
  }
  if (includeCancel && allowed.includes("cancel")) {
    const cancel = button("Cancel");
    cancel.addEventListener("click", (event) => {
      event.stopPropagation();
      cancelTask(task);
    });
    actions.appendChild(cancel);
  }
  return actions;
}

function renderTaskCard(task, { full = false } = {}) {
  const expanded = (full ? state.expandedItemId : state.expandedTaskId) === task.id;
  const card = document.createElement("article");
  card.className = `task-card ${expanded ? "expanded" : ""} ${task.pinned ? "pinned" : ""}`;
  card.tabIndex = 0;
  applyCategoryVars(card, task);
  const main = document.createElement("div");
  main.className = "task-main";
  const titleWrap = document.createElement("div");
  titleWrap.className = "task-title-wrap";
  const title = document.createElement("h3");
  title.textContent = task.title;
  titleWrap.appendChild(title);
  if (task.pinned) {
    const pinned = document.createElement("span");
    pinned.className = "pin-label";
    pinned.textContent = "PINNED";
    titleWrap.appendChild(pinned);
  }
  const deadline = document.createElement("div");
  deadline.className = "task-deadline";
  deadline.textContent = task.deadlineLabel || "";
  main.append(titleWrap, deadline);
  card.appendChild(main);
  let clickTimer = null;
  card.addEventListener("click", () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      if (full) state.expandedItemId = expanded ? null : task.id;
      else state.expandedTaskId = expanded ? null : task.id;
      render();
    }, 180);
  });
  bindTaskDoubleTap(card, task, { full, complete: completeTask, cancelClick: () => clearTimeout(clickTimer) });
  if (expanded) {
    const details = document.createElement("div");
    details.className = "task-details";
    if (task.description) {
      const description = document.createElement("p");
      description.textContent = task.description;
      details.appendChild(description);
    }
    const meta = document.createElement("div");
    meta.className = "detail-line";
    if (categoryFor(task).label) {
      const category = document.createElement("strong");
      category.textContent = categoryFor(task).label;
      meta.appendChild(category);
    }
    if (task.tags?.length) {
      const tags = document.createElement("span");
      tags.textContent = task.tags.map(tag => `#${tag}`).join(" ");
      meta.appendChild(tags);
    }
    if (task.status && full) {
      const status = document.createElement("span");
      status.textContent = task.status.toUpperCase();
      meta.appendChild(status);
    }
    if (meta.children.length) details.appendChild(meta);
    details.appendChild(taskActions(task, { includeCancel: full }));
    card.appendChild(details);
  }
  return card;
}

function completeTask(task) {
  const isBoard = state.route === "board";
  const restore = clone(isBoard ? state.snapshot : state.viewItems);
  if (isBoard) {
    state.snapshot.tasks = state.snapshot.tasks.filter(item => item.id !== task.id);
    state.expandedTaskId = null;
  } else {
    state.viewItems = state.viewItems.filter(item => item.id !== task.id);
    state.expandedItemId = null;
  }
  render();
  stageMutation({ message: `✓ ${task.title} completed`, restore, commit: () => persistCompleteTask(task.object_id) });
}

function cancelTask(task) {
  const restore = clone(state.viewItems);
  state.viewItems = state.viewItems.filter(item => item.id !== task.id);
  state.expandedItemId = null;
  render();
  stageMutation({ message: `${task.title} cancelled`, restore, commit: () => persistCancelTask(task.object_id) });
}

function togglePin(item) {
  const isBoard = state.route === "board";
  const restore = clone(isBoard ? state.snapshot : state.viewItems);
  const collection = isBoard ? state.snapshot.tasks : state.viewItems;
  const found = collection.find(candidate => candidate.id === item.id);
  if (found) found.pinned = !found.pinned;
  const desiredPinned = Boolean(found?.pinned);
  render();
  stageMutation({
    message: `${found?.pinned ? "Pinned" : "Unpinned"} ${item.title}`,
    restore,
    commit: () => desiredPinned ? pinObject(item.object_id) : unpinObject(item.object_id),
  });
}

async function editTask(task) {
  const title = prompt("Task title", task.title);
  if (title === null) return;
  const description = prompt("Task description", task.description ?? "");
  if (description === null) return;
  try {
    await persistUpdateTask(task.object_id, { title, description: description || null });
    Object.assign(task, { title, description });
    render();
    showMessage("Task saved");
    hideStripSoon();
  } catch {
    showMessage("Task was not saved. Please try again.", { error: true });
    hideStripSoon();
  }
}

function renderEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function renderBoardTasks() {
  const section = document.createElement("section");
  section.className = "task-board";
  section.setAttribute("aria-label", "Upcoming tasks");
  const header = document.createElement("div");
  header.className = "section-header";
  const titleGroup = document.createElement("div");
  titleGroup.className = "title-with-menu";
  titleGroup.appendChild(renderMenuButton());
  const copy = document.createElement("div");
  copy.innerHTML = `<p class="eyebrow">UPCOMING</p><h1>Household tasks</h1>`;
  titleGroup.appendChild(copy);
  const count = document.createElement("div");
  count.className = "task-count";
  count.textContent = String(state.snapshot.tasks.length);
  header.append(titleGroup, count);
  section.appendChild(header);
  const list = document.createElement("div");
  list.className = "task-list";
  if (state.snapshot.tasks.length) state.snapshot.tasks.forEach(task => list.appendChild(renderTaskCard(task)));
  else list.appendChild(renderEmpty("Nothing needs attention right now."));
  section.appendChild(list);
  return section;
}

function renderAllDay(day) {
  const wrap = document.createElement("div");
  wrap.className = "all-day-band";
  const { visible, hiddenCount } = visibleAllDayItems(day.allDay);
  visible.forEach((item) => {
    const pill = document.createElement("div");
    pill.className = "all-day-item";
    applyCategoryVars(pill, item, 0.2);
    const title = document.createElement("span");
    title.textContent = item.title;
    const span = document.createElement("small");
    span.textContent = item.span ?? "";
    pill.append(title, span);
    wrap.appendChild(pill);
  });
  if (hiddenCount) {
    const more = document.createElement("div");
    more.className = "all-day-more";
    more.textContent = `+ ${hiddenCount} more`;
    wrap.appendChild(more);
  }
  return wrap;
}

function renderEventCard(event, day) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `calendar-event ${day.id === "tomorrow" ? "compact" : ""} ${state.selectedEventId === event.id ? "selected" : ""}`;
  applyCategoryVars(card, event, 0.2);
  card.style.top = `${event.top}px`;
  card.style.height = `${event.height}px`;
  card.style.left = `calc(${event.leftPercent}% + 3px)`;
  card.style.width = `calc(${event.widthPercent}% - 6px)`;
  const title = document.createElement("strong");
  title.textContent = event.title;
  const time = document.createElement("span");
  time.textContent = day.id === "tomorrow" ? event.start : `${formatTime(event.start)}-${formatTime(event.end)}`;
  card.append(title, time);
  card.addEventListener("click", (click) => {
    click.stopPropagation();
    state.selectedEventId = state.selectedEventId === event.id ? null : event.id;
    render();
  });
  return card;
}

function renderEventPopover() {
  const events = state.route === "board"
    ? state.snapshot.days.flatMap(day => day.events.map(event => ({ ...event, day })))
    : state.viewItems.filter(event => event.time_kind === "timed").map(event => ({ ...event, day: { label: event.date } }));
  const event = events.find(item => item.id === state.selectedEventId);
  if (!event) return null;
  const popover = document.createElement("aside");
  popover.className = "event-popover";
  applyCategoryVars(popover, event, 0.16);
  const content = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `${event.day.label} · ${event.start ? formatTime(event.start) : ""}`;
  const title = document.createElement("h2");
  title.textContent = event.title;
  const description = document.createElement("p");
  description.textContent = event.detail || event.description || "";
  const detail = document.createElement("div");
  detail.className = "detail-line";
  if (categoryFor(event).label) {
    const category = document.createElement("strong");
    category.textContent = categoryFor(event).label;
    detail.appendChild(category);
  }
  content.append(eyebrow, title, description, detail);
  popover.appendChild(content);
  const actions = document.createElement("div");
  actions.className = "task-actions";
  const done = button("Done", "solid-button");
  done.addEventListener("click", () => {
    state.selectedEventId = null;
    render();
  });
  actions.appendChild(done);
  popover.appendChild(actions);
  return popover;
}

function renderDay(day) {
  const pixelsPerHour = currentPixelsPerHour();
  const column = document.createElement("section");
  column.className = `day-column ${day.id}`;
  column.setAttribute("aria-label", `${day.label} calendar`);
  const heading = document.createElement("header");
  heading.className = "day-heading";
  const headingText = document.createElement("div");
  const label = document.createElement("p");
  label.className = "eyebrow";
  label.textContent = day.label;
  const date = document.createElement("h2");
  date.textContent = day.dateLabel;
  headingText.append(label, date);
  heading.appendChild(headingText);
  column.appendChild(heading);
  column.appendChild(renderAllDay(day));
  const grid = document.createElement("div");
  grid.className = "day-grid";
  grid.style.height = `${minutesToPixels(DAY_END_MINUTE, pixelsPerHour)}px`;
  hourLabels(pixelsPerHour).forEach((hour) => {
    const line = document.createElement("div");
    line.className = "hour-line";
    line.style.top = `${hour.top}px`;
    grid.appendChild(line);
  });
  if (day.isToday) {
    const now = new Date(state.snapshot?.now ?? new Date());
    const line = document.createElement("div");
    line.className = "now-line";
    line.style.top = `${minutesToPixels(now.getHours() * 60 + now.getMinutes(), pixelsPerHour)}px`;
    grid.appendChild(line);
  }
  layoutTimedEvents(day.events, pixelsPerHour).forEach(event => grid.appendChild(renderEventCard(event, day)));
  column.appendChild(grid);
  return column;
}

function renderBoardCalendar() {
  const visibleEnd = Math.min(24, state.displaySettings.startHour + state.displaySettings.visibleHours);
  const section = document.createElement("section");
  section.className = "calendar-board";
  section.setAttribute("aria-label", "Calendar");
  section.innerHTML = `<div class="section-header calendar-header"><div><p class="eyebrow">CALENDAR</p><h1>Today and tomorrow</h1></div><div class="time-range">${formatHour(state.displaySettings.startHour)}-${formatHour(visibleEnd)}</div></div>`;
  const scroller = document.createElement("div");
  scroller.className = "calendar-scroll board-calendar-scroll";
  scroller.addEventListener("click", () => {
    state.selectedEventId = null;
    render();
  });
  const scale = document.createElement("div");
  scale.className = "time-scale";
  scale.style.height = `${minutesToPixels(DAY_END_MINUTE, currentPixelsPerHour())}px`;
  hourLabels(currentPixelsPerHour()).forEach((hour) => {
    const label = document.createElement("div");
    label.className = "hour-label";
    label.style.top = `${hour.top}px`;
    label.textContent = hour.label;
    scale.appendChild(label);
  });
  const days = document.createElement("div");
  days.className = "day-pair";
  state.snapshot.days.forEach(day => days.appendChild(renderDay(day)));
  scroller.append(scale, days);
  section.appendChild(scroller);
  const popover = renderEventPopover();
  if (popover) section.appendChild(popover);
  return section;
}

function setInitialCalendarScroll(force = false) {
  document.querySelectorAll(".calendar-scroll").forEach((scroller) => {
    if (force || scroller.scrollTop < 10) scroller.scrollTop = minutesToPixels(state.displaySettings.startHour * 60, currentPixelsPerHour());
  });
}

function measureCalendarScale() {
  const scroller = document.querySelector(".board-calendar-scroll");
  if (!scroller) return;
  const next = computePaneHourPixels({ paneHeight: scroller.clientHeight, visibleHours: state.displaySettings.visibleHours });
  if (Math.abs(next - state.measuredHourPixels) > 1) {
    state.measuredHourPixels = next;
    applyDisplaySettings();
    render();
  }
}

function renderDivider() {
  const divider = document.createElement("div");
  divider.className = "pane-divider";
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  divider.setAttribute("aria-label", "Resize tasks and calendar");
  divider.tabIndex = 0;
  const setFromClientX = (clientX, persist = false) => {
    const rect = root.getBoundingClientRect();
    const percent = ((clientX - rect.left) / rect.width) * 100;
    state.displaySettings = normalizeDisplaySettings({ ...state.displaySettings, taskSplitPercent: percent });
    applyDisplaySettings();
    if (persist) saveDisplaySettings(state.displaySettings);
  };
  divider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    divider.classList.add("dragging");
    setFromClientX(event.clientX);
  });
  divider.addEventListener("pointermove", (event) => {
    if (divider.hasPointerCapture(event.pointerId)) setFromClientX(event.clientX);
  });
  divider.addEventListener("pointerup", (event) => {
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    divider.classList.remove("dragging");
    setFromClientX(event.clientX, true);
  });
  return divider;
}

function controlInput({ placeholder, value, onInput }) {
  const input = document.createElement("input");
  input.className = "view-input";
  input.placeholder = placeholder;
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function scheduleSearch(route) {
  clearTimeout(searchTimer);
  ++viewRequest;
  searchTimer = setTimeout(() => {
    searchTimer = null;
    if (state.route === route) (route === "tasks" ? loadTaskView : loadKnowledgeView)({ preserveControls: true });
  }, 250);
}

function selectControl({ value, options, onChange }) {
  const select = document.createElement("select");
  select.className = "view-select";
  options.forEach(({ label, value: optionValue }) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    option.selected = optionValue === value;
    select.appendChild(option);
  });
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function renderTaskView() {
  const main = document.createElement("main");
  main.className = "view-shell";
  main.appendChild(renderHeader("Tasks", "TASKS"));
  const controls = document.createElement("div");
  controls.className = "view-controls";
  controls.append(
    controlInput({ placeholder: "Search tasks", value: state.filters.tasks.query, onInput: value => { state.filters.tasks.query = value; scheduleSearch("tasks"); } }),
    selectControl({ value: state.filters.tasks.status, options: [{ label: "Open", value: "open" }, { label: "Completed", value: "completed" }, { label: "Cancelled", value: "cancelled" }, { label: "All statuses", value: "" }], onChange: value => { state.filters.tasks.status = value; loadTaskView(); } }),
    selectControl({ value: state.filters.tasks.categoryId, options: [{ label: "All categories", value: "" }, ...state.categories.map(category => ({ label: category.name, value: category.object_id }))], onChange: value => { state.filters.tasks.categoryId = value; loadTaskView(); } }),
  );
  main.appendChild(controls);
  const list = document.createElement("div");
  list.className = "view-list task-view-list";
  if (state.viewLoading) list.appendChild(renderEmpty("Loading tasks..."));
  else if (!state.viewItems.length) list.appendChild(renderEmpty("No tasks match this view."));
  else state.viewItems.forEach(task => list.appendChild(renderTaskCard(task, { full: true })));
  main.appendChild(list);
  return main;
}

function dayName(date) {
  return new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

function spanForAllDay(event) {
  if (!event.start_date || !event.end_date) return "";
  return event.start_date === isoDate(addDays(new Date(`${event.end_date}T00:00:00Z`), -1)) ? event.start_date.slice(5) : `${event.start_date.slice(5)}-${event.end_date.slice(5)}`;
}

function renderWeekView() {
  const main = document.createElement("main");
  main.className = "view-shell calendar-week-shell";
  const header = renderHeader("Calendar", "WEEK");
  const nav = document.createElement("div");
  nav.className = "week-nav";
  const previous = button("Previous week");
  previous.addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); loadCalendarView(); });
  const current = button("Current week", "solid-button");
  current.addEventListener("click", () => { state.weekStart = startOfWeek(new Date()); loadCalendarView(); });
  const next = button("Next week");
  next.addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); loadCalendarView(); });
  nav.append(previous, current, next);
  header.appendChild(nav);
  main.appendChild(header);
  main.appendChild(renderWeekCalendar());
  return main;
}

function renderWeekCalendar() {
  const wrap = document.createElement("section");
  wrap.className = "week-calendar";
  if (state.viewLoading) {
    wrap.appendChild(renderEmpty("Loading calendar..."));
    return wrap;
  }
  const days = weekDays(state.weekStart).map(date => ({ date, key: isoDate(date) }));
  const scroller = document.createElement("div");
  scroller.className = "calendar-scroll week-scroll";
  const scale = document.createElement("div");
  scale.className = "time-scale week-time-scale";
  scale.style.height = `${minutesToPixels(DAY_END_MINUTE, currentPixelsPerHour())}px`;
  hourLabels(currentPixelsPerHour()).forEach(hour => {
    const label = document.createElement("div");
    label.className = "hour-label";
    label.style.top = `${hour.top}px`;
    label.textContent = hour.label;
    scale.appendChild(label);
  });
  const grid = document.createElement("div");
  grid.className = "week-grid";
  days.forEach(({ date, key }) => {
    const column = document.createElement("section");
    column.className = "week-day";
    column.innerHTML = `<header class="day-heading"><p class="eyebrow">${dayName(date).split(" ")[0]}</p><h2>${dayName(date)}</h2></header>`;
    const allDay = document.createElement("div");
    allDay.className = "all-day-band";
    state.viewItems.filter(event => event.time_kind === "all_day" && event.start_date <= key && event.end_date > key).slice(0, 2).forEach(event => {
      const pill = document.createElement("div");
      pill.className = "all-day-item";
      applyCategoryVars(pill, event, 0.2);
      const title = document.createElement("span");
      title.textContent = event.title;
      const span = document.createElement("small");
      span.textContent = spanForAllDay(event);
      pill.append(title, span);
      allDay.appendChild(pill);
    });
    column.appendChild(allDay);
    const dayGrid = document.createElement("div");
    dayGrid.className = "day-grid";
    dayGrid.style.height = `${minutesToPixels(DAY_END_MINUTE, currentPixelsPerHour())}px`;
    hourLabels(currentPixelsPerHour()).forEach(hour => {
      const line = document.createElement("div");
      line.className = "hour-line";
      line.style.top = `${hour.top}px`;
      dayGrid.appendChild(line);
    });
    if (key === localDateKey(new Date(), DEFAULT_TIMEZONE)) {
      const now = new Date();
      const line = document.createElement("div");
      line.className = "now-line";
      line.style.top = `${minutesToPixels(localTimeMinutes(now, DEFAULT_TIMEZONE), currentPixelsPerHour())}px`;
      dayGrid.appendChild(line);
    }
    const timed = state.viewItems.filter(event => event.time_kind === "timed" && eventDateKey(event) === key);
    layoutTimedEvents(timed, currentPixelsPerHour()).forEach(event => dayGrid.appendChild(renderEventCard(event, { id: key, label: key })));
    column.appendChild(dayGrid);
    grid.appendChild(column);
  });
  scroller.append(scale, grid);
  wrap.appendChild(scroller);
  const popover = renderEventPopover();
  if (popover) wrap.appendChild(popover);
  requestAnimationFrame(() => setInitialCalendarScroll());
  return wrap;
}

function renderKnowledgeView() {
  const main = document.createElement("main");
  main.className = "view-shell";
  main.appendChild(renderHeader("Knowledge", "MEMORY"));
  const controls = document.createElement("div");
  controls.className = "view-controls";
  controls.append(
    controlInput({ placeholder: "Search knowledge", value: state.filters.knowledge.query, onInput: value => { state.filters.knowledge.query = value; scheduleSearch("knowledge"); } }),
    selectControl({ value: state.filters.knowledge.categoryId, options: [{ label: "All categories", value: "" }, ...state.categories.map(category => ({ label: category.name, value: category.object_id }))], onChange: value => { state.filters.knowledge.categoryId = value; loadKnowledgeView(); } }),
    selectControl({ value: state.filters.knowledge.tagName, options: [{ label: "All tags", value: "" }, ...state.tags.map(tag => ({ label: tag.name, value: tag.name }))], onChange: value => { state.filters.knowledge.tagName = value; loadKnowledgeView(); } }),
  );
  main.appendChild(controls);
  const list = document.createElement("div");
  list.className = "view-list knowledge-list";
  if (state.viewLoading) list.appendChild(renderEmpty("Loading knowledge..."));
  else if (!state.viewItems.length) list.appendChild(renderEmpty("No knowledge entries match this view."));
  else state.viewItems.forEach(item => list.appendChild(renderKnowledgeCard(item)));
  main.appendChild(list);
  return main;
}

function renderKnowledgeCard(item) {
  const expanded = state.expandedItemId === item.id;
  const card = document.createElement("article");
  card.className = `task-card knowledge-card ${expanded ? "expanded" : ""}`;
  applyCategoryVars(card, item);
  card.addEventListener("click", () => {
    state.expandedItemId = expanded ? null : item.id;
    render();
  });
  const main = document.createElement("div");
  main.className = "task-main";
  const titleWrap = document.createElement("div");
  titleWrap.className = "task-title-wrap";
  const title = document.createElement("h3");
  title.textContent = item.title;
  titleWrap.appendChild(title);
  const deadline = document.createElement("div");
  deadline.className = "task-deadline";
  main.append(titleWrap, deadline);
  card.appendChild(main);
  if (expanded) {
    const details = document.createElement("div");
    details.className = "task-details";
    const content = document.createElement("p");
    content.textContent = item.content;
    details.appendChild(content);
    const meta = document.createElement("div");
    meta.className = "detail-line";
    if (categoryFor(item).label) {
      const category = document.createElement("strong");
      category.textContent = categoryFor(item).label;
      meta.appendChild(category);
    }
    if (item.tags?.length) {
      const tags = document.createElement("span");
      tags.textContent = item.tags.map(tag => `#${tag}`).join(" ");
      meta.appendChild(tags);
    }
    if (meta.children.length) details.appendChild(meta);
    const actions = document.createElement("div");
    actions.className = "task-actions";
    const edit = button("Edit", "solid-button");
    edit.addEventListener("click", (event) => {
      event.stopPropagation();
      editKnowledge(item);
    });
    const archive = button("Archive");
    archive.addEventListener("click", (event) => {
      event.stopPropagation();
      archiveKnowledge(item);
    });
    actions.append(edit, archive);
    details.appendChild(actions);
    card.appendChild(details);
  }
  return card;
}

async function editKnowledge(item) {
  const title = prompt("Knowledge title", item.title);
  if (title === null) return;
  const content = prompt("Knowledge content", item.content);
  if (content === null) return;
  try {
    await persistUpdateKnowledge(item.object_id, { title, content });
    Object.assign(item, { title, content });
    render();
    showMessage("Knowledge saved");
    hideStripSoon();
  } catch {
    showMessage("Knowledge was not saved. Please try again.", { error: true });
    hideStripSoon();
  }
}

function archiveKnowledge(item) {
  const restore = clone(state.viewItems);
  state.viewItems = state.viewItems.filter(candidate => candidate.id !== item.id);
  state.expandedItemId = null;
  render();
  stageMutation({ message: `${item.title} archived`, restore, commit: () => persistArchiveKnowledge(item.object_id) });
}

function renderNavOverlay() {
  if (!state.navOpen && !state.settingsOpen) return null;
  const overlay = document.createElement("div");
  overlay.className = "board-overlay";
  overlay.addEventListener("click", () => {
    state.navOpen = false;
    state.settingsOpen = false;
    render();
  });
  const panel = document.createElement("aside");
  panel.className = state.settingsOpen ? "nav-drawer settings-drawer" : "nav-drawer";
  panel.addEventListener("click", event => event.stopPropagation());
  overlay.appendChild(panel);
  panel.appendChild(state.settingsOpen ? renderDisplaySettings() : renderNavigation());
  return overlay;
}

function renderNavigation() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="drawer-header"><div><p class="eyebrow">ASSISTANT</p><h2>Views</h2></div><button type="button" class="icon-button" aria-label="Close menu">×</button></div>`;
  wrap.querySelector("button").addEventListener("click", () => {
    state.navOpen = false;
    render();
  });
  const list = document.createElement("div");
  list.className = "nav-list";
  [["Board", "board"], ["Tasks", "tasks"], ["Calendar", "calendar"], ["Knowledge", "knowledge"], ["Settings", "settings"]].forEach(([label, route]) => {
    const item = button(label, route === state.route ? "nav-item active" : "nav-item");
    item.addEventListener("click", () => {
      if (route === "settings") {
        state.settingsOpen = true;
        state.navOpen = false;
        render();
      } else navigate(route);
    });
    list.appendChild(item);
  });
  wrap.appendChild(list);
  return wrap;
}

function labeledRange({ label, value, min, max, step = 1, suffix = "", onInput }) {
  const row = document.createElement("label");
  row.className = "setting-row";
  const text = document.createElement("span");
  text.textContent = label;
  row.appendChild(text);
  const valueText = document.createElement("span");
  valueText.className = "setting-value";
  valueText.textContent = `${value}${suffix}`;
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => {
    valueText.textContent = `${input.value}${suffix}`;
    onInput(Number(input.value));
  });
  row.append(valueText, input);
  return row;
}

function renderChoice(label, current, options, onChange) {
  const field = document.createElement("fieldset");
  field.className = "choice-setting";
  const legend = document.createElement("legend");
  legend.textContent = label;
  field.appendChild(legend);
  const group = document.createElement("div");
  group.className = "choice-group";
  options.forEach((option) => {
    const choice = button(option[0].toUpperCase() + option.slice(1), option === current ? "choice-button selected" : "choice-button");
    choice.addEventListener("click", () => onChange(option));
    group.appendChild(choice);
  });
  field.appendChild(group);
  return field;
}

function renderDisplaySettings() {
  const settings = state.displaySettings;
  const wrap = document.createElement("div");
  wrap.innerHTML = `<div class="drawer-header"><div><p class="eyebrow">DISPLAY</p><h2>Settings</h2></div><button type="button" class="icon-button" aria-label="Close settings">×</button></div>`;
  wrap.querySelector("button").addEventListener("click", () => {
    state.settingsOpen = false;
    render();
  });
  const form = document.createElement("div");
  form.className = "settings-form";
  form.append(
    labeledRange({ label: "Text size", value: settings.textScale, min: 85, max: 130, suffix: "%", onInput: value => updateDisplaySettings({ textScale: value }, { renderBoard: false }) }),
    labeledRange({ label: "Tasks width", value: settings.taskSplitPercent, min: 30, max: 48, suffix: "%", onInput: value => updateDisplaySettings({ taskSplitPercent: value }, { renderBoard: false }) }),
    renderChoice("Calendar visible hours", String(settings.visibleHours), VISIBLE_HOUR_OPTIONS.map(String), value => updateDisplaySettings({ visibleHours: Number(value) })),
    labeledRange({ label: "Calendar starting hour", value: settings.startHour, min: 0, max: 18, suffix: ":00", onInput: value => { updateDisplaySettings({ startHour: value }, { renderBoard: false }); setInitialCalendarScroll(true); } }),
    labeledRange({ label: "Today width", value: settings.todayWidthPercent, min: 55, max: 72, suffix: "%", onInput: value => updateDisplaySettings({ todayWidthPercent: value }, { renderBoard: false }) }),
    renderChoice("Category tint", settings.categoryTint, ["low", "medium", "strong"], value => updateDisplaySettings({ categoryTint: value })),
  );
  const reset = button("Reset display settings", "reset-button");
  reset.addEventListener("click", restoreDefaultDisplaySettings);
  form.appendChild(reset);
  wrap.appendChild(form);
  return wrap;
}

function renderLoading() {
  root.innerHTML = "";
  const loading = document.createElement("main");
  loading.className = "board-state";
  loading.textContent = "Loading Assistant...";
  root.appendChild(loading);
}

function renderError() {
  root.innerHTML = "";
  const error = document.createElement("main");
  error.className = "board-state error-state";
  const message = document.createElement("p");
  message.textContent = state.error?.message || "Assistant could not load.";
  const retry = button("Retry", "solid-button");
  retry.addEventListener("click", loadCurrentView);
  error.append(message, retry);
  root.appendChild(error);
}

function renderBoard() {
  const shell = document.createElement("main");
  shell.className = "board-shell";
  shell.append(renderBoardTasks(), renderDivider(), renderBoardCalendar());
  return shell;
}

function render() {
  if (state.loading) return renderLoading();
  if (state.error) return renderError();
  root.innerHTML = "";
  applyDisplaySettings();
  const shell = state.route === "board" ? renderBoard() : state.route === "tasks" ? renderTaskView() : state.route === "calendar" ? renderWeekView() : renderKnowledgeView();
  root.appendChild(shell);
  const overlay = renderNavOverlay();
  if (overlay) root.appendChild(overlay);
  requestAnimationFrame(() => {
    measureCalendarScale();
    setInitialCalendarScroll();
  });
}

async function loadChromeData() {
  if (state.categories.length) return;
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  state.categories = categories;
  state.tags = tags;
}

async function loadBoard() {
  const request = ++viewRequest;
  state.loading = true;
  state.error = null;
  render();
  try {
    const snapshot = await getBoardSnapshot();
    if (request !== viewRequest || state.route !== "board") return;
    state.snapshot = snapshot;
  } catch (error) {
    if (request !== viewRequest || state.route !== "board") return;
    state.error = error;
  } finally {
    if (request === viewRequest && state.route === "board") {
      state.loading = false;
      render();
    }
  }
}

function renderListOnly() {
  const list = document.querySelector(".view-list");
  if (!list) return render();
  const fresh = state.route === "tasks" ? renderTaskView() : renderKnowledgeView();
  list.replaceWith(fresh.querySelector(".view-list"));
}

async function loadTaskView({ preserveControls = false } = {}) {
  const request = ++viewRequest;
  state.viewLoading = true;
  state.error = null;
  if (preserveControls) renderListOnly(); else render();
  try {
    await loadChromeData();
    const items = await listTaskView({ ...state.filters.tasks });
    if (request !== viewRequest || state.route !== "tasks") return;
    state.viewItems = items;
  } catch (error) {
    if (request !== viewRequest || state.route !== "tasks") return;
    state.error = error;
  } finally {
    if (request === viewRequest && state.route === "tasks") {
      state.viewLoading = false;
      state.loading = false;
      if (preserveControls && !state.error) renderListOnly(); else render();
    }
  }
}

async function loadCalendarView() {
  const request = ++viewRequest;
  state.viewLoading = true;
  state.error = null;
  render();
  try {
    const range = weekRange(state.weekStart);
    const items = await listWeekEvents({ weekStart: range.start, weekEnd: range.endExclusive, timezone: DEFAULT_TIMEZONE });
    if (request !== viewRequest || state.route !== "calendar") return;
    state.viewItems = items;
  } catch (error) {
    if (request !== viewRequest || state.route !== "calendar") return;
    state.error = error;
  } finally {
    if (request === viewRequest && state.route === "calendar") {
      state.viewLoading = false;
      state.loading = false;
      render();
    }
  }
}

async function loadKnowledgeView({ preserveControls = false } = {}) {
  const request = ++viewRequest;
  state.viewLoading = true;
  state.error = null;
  if (preserveControls) renderListOnly(); else render();
  try {
    await loadChromeData();
    const items = await listKnowledgeView({ ...state.filters.knowledge });
    if (request !== viewRequest || state.route !== "knowledge") return;
    state.viewItems = items;
  } catch (error) {
    if (request !== viewRequest || state.route !== "knowledge") return;
    state.error = error;
  } finally {
    if (request === viewRequest && state.route === "knowledge") {
      state.viewLoading = false;
      state.loading = false;
      if (preserveControls && !state.error) renderListOnly(); else render();
    }
  }
}

async function loadCurrentView() {
  ++viewRequest;
  clearTimeout(searchTimer);
  state.expandedItemId = null;
  state.expandedTaskId = null;
  state.selectedEventId = null;
  if (state.route === "board") return loadBoard();
  state.loading = false;
  if (state.route === "tasks") return loadTaskView();
  if (state.route === "calendar") return loadCalendarView();
  return loadKnowledgeView();
}

window.addEventListener("popstate", () => {
  state.route = routeFromPath(location.pathname);
  loadCurrentView();
});
window.addEventListener("resize", () => requestAnimationFrame(measureCalendarScale));
window.addEventListener("focus", () => {
  if (!state.pendingMutation) loadCurrentView();
});

async function autoRefresh() {
  if (state.pendingMutation) return;
  if (state.route === "board") return loadBoard();
  if (state.route === "tasks") return loadTaskView({ preserveControls: true });
  if (state.route === "calendar") return loadCalendarView();
  return loadKnowledgeView({ preserveControls: true });
}

loadCurrentView();
setInterval(autoRefresh, AUTO_REFRESH_MS);
