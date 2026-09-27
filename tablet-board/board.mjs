import {
  completeTask as persistCompleteTask,
  getBoardSnapshot,
  neutralCategory,
  pinObject,
  unpinObject,
} from "./data-provider.mjs";
import { StagedMutationController } from "./mutation-staging.mjs";
import {
  DAY_END_MINUTE,
  PIXELS_PER_HOUR,
  formatTime,
  hourLabels,
  layoutTimedEvents,
  minutesToPixels,
  visibleAllDayItems,
} from "./calendar-layout.mjs";
import {
  VISIBLE_HOUR_OPTIONS,
  loadDisplaySettings,
  normalizeDisplaySettings,
  pixelsPerHourFor,
  resetDisplaySettings,
  saveDisplaySettings,
  tintAlpha,
} from "./display-settings.mjs";

const STAGE_DELAY_MS = 5000;

const state = {
  snapshot: null,
  loading: true,
  error: null,
  expandedTaskId: null,
  pendingMutation: null,
  selectedEventId: null,
  displaySettings: loadDisplaySettings(),
  navOpen: false,
  settingsOpen: false,
};

const root = document.querySelector("#board-root");
const undoStrip = document.querySelector("#undo-strip");
const staging = new StagedMutationController({ delayMs: STAGE_DELAY_MS });

function clone(value) {
  return structuredClone(value);
}

function categoryFor(item) {
  return item?.category ?? neutralCategory;
}

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

function setStatusStrip(message, { undo, error = false } = {}) {
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

function clearPendingMutation() {
  staging.cancel();
  state.pendingMutation = null;
}

function hideStripSoon() {
  setTimeout(() => {
    if (!state.pendingMutation) undoStrip.hidden = true;
  }, 1600);
}

function restoreSnapshot(snapshot) {
  state.snapshot = clone(snapshot);
  state.expandedTaskId = null;
  render();
}

function stageMutation({ message, restore, commit }) {
  staging.stage({
    restore,
    commit,
    onCommit: () => {
      state.pendingMutation = null;
      undoStrip.hidden = true;
    },
    onUndo: restoreSnapshot,
    onFailure: (snapshot) => {
      state.pendingMutation = null;
      restoreSnapshot(snapshot);
      setStatusStrip("Change was not saved. Please try again.", { error: true });
      hideStripSoon();
    },
  });
  state.pendingMutation = { restore };
  setStatusStrip(message, {
    undo: () => {
      staging.undo();
      state.pendingMutation = null;
      undoStrip.hidden = true;
    },
  });
}

function renderTask(task) {
  const card = document.createElement("article");
  card.className = `task-card ${state.expandedTaskId === task.id ? "expanded" : ""} ${task.pinned ? "pinned" : ""}`;
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
      state.expandedTaskId = state.expandedTaskId === task.id ? null : task.id;
      render();
    }, 180);
  });

  card.addEventListener("dblclick", (event) => {
    event.preventDefault();
    clearTimeout(clickTimer);
    completeTask(task.id);
  });

  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      state.expandedTaskId = state.expandedTaskId === task.id ? null : task.id;
      render();
    }
  });

  if (state.expandedTaskId === task.id) {
    const details = document.createElement("div");
    details.className = "task-details";
    const description = document.createElement("p");
    description.textContent = task.description || "";
    details.appendChild(description);

    const meta = document.createElement("div");
    meta.className = "detail-line";
    if (categoryFor(task).label) {
      const category = document.createElement("strong");
      category.textContent = categoryFor(task).label;
      meta.appendChild(category);
    }
    if (task.tags.length) {
      const tags = document.createElement("span");
      tags.textContent = task.tags.map((tag) => `#${tag}`).join(" ");
      meta.appendChild(tags);
    }
    if (meta.children.length) details.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "task-actions";
    const complete = button("Complete", "solid-button");
    complete.addEventListener("click", (event) => {
      event.stopPropagation();
      completeTask(task.id);
    });
    const pin = button(task.pinned ? "Unpin" : "Pin");
    pin.addEventListener("click", (event) => {
      event.stopPropagation();
      togglePin(task.id);
    });
    const edit = button("Edit");
    edit.disabled = true;
    edit.title = "Editing stays in the full Assistant tools for now.";
    actions.append(complete, pin, edit);
    details.appendChild(actions);
    card.appendChild(details);
  }

  return card;
}

function updateDisplaySettings(patch, { renderBoard = true } = {}) {
  state.displaySettings = saveDisplaySettings({ ...state.displaySettings, ...patch });
  applyDisplaySettings();
  if (renderBoard) render();
}

function restoreDefaultDisplaySettings() {
  state.displaySettings = resetDisplaySettings();
  render();
}

function currentPixelsPerHour() {
  return pixelsPerHourFor(state.displaySettings, PIXELS_PER_HOUR);
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

function formatHour(hour) {
  const wrapped = ((hour % 24) + 24) % 24;
  if (wrapped === 0) return "12 AM";
  if (wrapped === 12) return "12 PM";
  return wrapped > 12 ? `${wrapped - 12} PM` : `${wrapped} AM`;
}

function updateTimeRangeLabel() {
  const label = document.querySelector(".time-range");
  if (!label) return;
  const visibleEnd = Math.min(24, state.displaySettings.startHour + state.displaySettings.visibleHours);
  label.textContent = `${formatHour(state.displaySettings.startHour)}-${formatHour(visibleEnd)}`;
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

function completeTask(taskId) {
  if (!state.snapshot) return;
  const task = state.snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const restore = clone(state.snapshot);
  state.snapshot.tasks = state.snapshot.tasks.filter((item) => item.id !== taskId);
  state.expandedTaskId = null;
  render();
  stageMutation({
    message: `✓ ${task.title} completed`,
    restore,
    commit: () => persistCompleteTask(task.object_id),
  });
}

function togglePin(taskId) {
  if (!state.snapshot) return;
  const task = state.snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return;
  const restore = clone(state.snapshot);
  task.pinned = !task.pinned;
  render();
  stageMutation({
    message: `${task.pinned ? "Pinned" : "Unpinned"} ${task.title}`,
    restore,
    commit: () => task.pinned ? pinObject(task.object_id) : unpinObject(task.object_id),
  });
}

function renderEmpty(message) {
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function renderTasks() {
  const section = document.createElement("section");
  section.className = "task-board";
  section.setAttribute("aria-label", "Upcoming tasks");
  const header = document.createElement("div");
  header.className = "section-header";
  const titleGroup = document.createElement("div");
  titleGroup.className = "title-with-menu";
  titleGroup.appendChild(renderMenuButton());
  const copy = document.createElement("div");
  copy.innerHTML = `
    <p class="eyebrow">UPCOMING</p>
    <h1>Household tasks</h1>
  `;
  titleGroup.appendChild(copy);
  const count = document.createElement("div");
  count.className = "task-count";
  count.textContent = String(state.snapshot.tasks.length);
  header.append(titleGroup, count);
  section.appendChild(header);
  const list = document.createElement("div");
  list.className = "task-list";
  if (state.snapshot.tasks.length) state.snapshot.tasks.forEach((task) => list.appendChild(renderTask(task)));
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
    pill.innerHTML = `<span>${item.title}</span><small>${item.span}</small>`;
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
  card.dataset.actualHeight = String(Math.round(event.actualHeight));
  card.innerHTML = `
    <strong>${event.title}</strong>
    <span>${day.id === "tomorrow" ? event.start : `${formatTime(event.start)}-${formatTime(event.end)}`}</span>
    ${day.id === "today" && event.height > 54 && event.location ? `<em>${event.location}</em>` : ""}
  `;
  card.addEventListener("click", (click) => {
    click.stopPropagation();
    state.selectedEventId = state.selectedEventId === event.id ? null : event.id;
    render();
  });
  return card;
}

function renderEventPopover() {
  const allEvents = state.snapshot.days.flatMap((day) => day.events.map((event) => ({ ...event, day })));
  const event = allEvents.find((item) => item.id === state.selectedEventId);
  if (!event) return null;

  const popover = document.createElement("aside");
  popover.className = "event-popover";
  applyCategoryVars(popover, event, 0.16);
  const category = categoryFor(event);
  popover.innerHTML = `
    <div>
      <p class="eyebrow">${event.day.label} · ${formatTime(event.start)}</p>
      <h2>${event.title}</h2>
      <p>${event.detail}</p>
      <div class="detail-line">${category.label ? `<strong>${category.label}</strong>` : ""}<span>${event.location || ""}</span></div>
    </div>
  `;
  const actions = document.createElement("div");
  actions.className = "task-actions";
  const done = button("Done", "solid-button");
  done.addEventListener("click", () => {
    state.selectedEventId = null;
    render();
  });
  const edit = button("Edit");
  edit.disabled = true;
  edit.title = "Calendar editing stays in the full Assistant tools for now.";
  actions.append(done, edit);
  popover.appendChild(actions);
  return popover;
}

function renderDay(day) {
  const pixelsPerHour = currentPixelsPerHour();
  const column = document.createElement("section");
  column.className = `day-column ${day.id}`;
  column.setAttribute("aria-label", `${day.label} calendar`);
  column.innerHTML = `
    <header class="day-heading">
      <div>
        <p class="eyebrow">${day.label}</p>
        <h2>${day.dateLabel}</h2>
      </div>
    </header>
  `;
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
    const now = new Date(state.snapshot.now);
    const minutes = now.getHours() * 60 + now.getMinutes();
    const line = document.createElement("div");
    line.className = "now-line";
    line.style.top = `${minutesToPixels(minutes, pixelsPerHour)}px`;
    grid.appendChild(line);
  }

  layoutTimedEvents(day.events, pixelsPerHour).forEach((event) => grid.appendChild(renderEventCard(event, day)));
  column.appendChild(grid);
  return column;
}

function renderCalendar() {
  const visibleEnd = Math.min(24, state.displaySettings.startHour + state.displaySettings.visibleHours);
  const section = document.createElement("section");
  section.className = "calendar-board";
  section.setAttribute("aria-label", "Calendar");
  section.innerHTML = `
    <div class="section-header calendar-header">
      <div>
        <p class="eyebrow">CALENDAR</p>
        <h1>Today and tomorrow</h1>
      </div>
      <div class="time-range">${formatHour(state.displaySettings.startHour)}-${formatHour(visibleEnd)}</div>
    </div>
  `;

  const scroller = document.createElement("div");
  scroller.className = "calendar-scroll";
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
  state.snapshot.days.forEach((day) => days.appendChild(renderDay(day)));
  scroller.append(scale, days);

  section.appendChild(scroller);
  const popover = renderEventPopover();
  if (popover) section.appendChild(popover);
  return section;
}

function setInitialCalendarScroll(force = false) {
  const scroller = document.querySelector(".calendar-scroll");
  if (scroller && (force || scroller.scrollTop < 10)) {
    scroller.scrollTop = minutesToPixels(state.displaySettings.startHour * 60, currentPixelsPerHour());
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
    if (!divider.hasPointerCapture(event.pointerId)) return;
    setFromClientX(event.clientX);
  });
  divider.addEventListener("pointerup", (event) => {
    if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
    divider.classList.remove("dragging");
    setFromClientX(event.clientX, true);
  });
  divider.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    updateDisplaySettings({ taskSplitPercent: state.displaySettings.taskSplitPercent + delta });
  });
  return divider;
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

  if (state.settingsOpen) {
    panel.appendChild(renderDisplaySettings());
  } else {
    panel.appendChild(renderNavigation());
  }
  return overlay;
}

function renderNavigation() {
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="drawer-header">
      <div>
        <p class="eyebrow">ASSISTANT</p>
        <h2>Views</h2>
      </div>
      <button type="button" class="icon-button" aria-label="Close menu">×</button>
    </div>
  `;
  wrap.querySelector("button").addEventListener("click", () => {
    state.navOpen = false;
    render();
  });
  const list = document.createElement("div");
  list.className = "nav-list";
  ["Board", "Tasks", "Calendar", "Knowledge", "Settings"].forEach((label) => {
    const item = button(label, label === "Board" ? "nav-item active" : "nav-item");
    if (label === "Settings") {
      item.addEventListener("click", () => {
        state.settingsOpen = true;
        state.navOpen = false;
        render();
      });
    } else if (label !== "Board") {
      item.disabled = true;
      item.title = `${label} view is not implemented in this prototype.`;
    } else {
      item.addEventListener("click", () => {
        state.navOpen = false;
        render();
      });
    }
    list.appendChild(item);
  });
  wrap.appendChild(list);
  return wrap;
}

function labeledRange({ label, value, min, max, step = 1, suffix = "", onInput }) {
  const row = document.createElement("label");
  row.className = "setting-row";
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
  row.innerHTML = `<span>${label}</span>`;
  row.append(valueText, input);
  return row;
}

function renderDisplaySettings() {
  const settings = state.displaySettings;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="drawer-header">
      <div>
        <p class="eyebrow">DISPLAY</p>
        <h2>Settings</h2>
      </div>
      <button type="button" class="icon-button" aria-label="Close settings">×</button>
    </div>
  `;
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
    labeledRange({
      label: "Calendar starting hour",
      value: settings.startHour,
      min: 0,
      max: 18,
      suffix: ":00",
      onInput: (value) => {
        updateDisplaySettings({ startHour: value }, { renderBoard: false });
        updateTimeRangeLabel();
        setInitialCalendarScroll(true);
      },
    }),
    labeledRange({ label: "Today width", value: settings.todayWidthPercent, min: 55, max: 72, suffix: "%", onInput: value => updateDisplaySettings({ todayWidthPercent: value }, { renderBoard: false }) }),
    renderChoice("Category tint", settings.categoryTint, ["low", "medium", "strong"], value => updateDisplaySettings({ categoryTint: value })),
  );
  const reset = button("Reset display settings", "reset-button");
  reset.addEventListener("click", restoreDefaultDisplaySettings);
  form.appendChild(reset);
  wrap.appendChild(form);
  return wrap;
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

function renderLoading() {
  root.innerHTML = "";
  const loading = document.createElement("main");
  loading.className = "board-state";
  loading.textContent = "Loading household board...";
  root.appendChild(loading);
}

function renderError() {
  root.innerHTML = "";
  const error = document.createElement("main");
  error.className = "board-state error-state";
  const message = document.createElement("p");
  message.textContent = state.error?.message || "The household board could not load.";
  const retry = button("Retry", "solid-button");
  retry.addEventListener("click", loadBoard);
  error.append(message, retry);
  root.appendChild(error);
}

function render() {
  if (state.loading) return renderLoading();
  if (state.error) return renderError();
  root.innerHTML = "";
  applyDisplaySettings();
  root.append(renderTasks(), renderDivider(), renderCalendar());
  const overlay = renderNavOverlay();
  if (overlay) root.appendChild(overlay);
  requestAnimationFrame(setInitialCalendarScroll);
}

async function loadBoard() {
  clearPendingMutation();
  undoStrip.hidden = true;
  state.loading = true;
  state.error = null;
  render();
  try {
    state.snapshot = await getBoardSnapshot();
  } catch (error) {
    state.error = error;
  } finally {
    state.loading = false;
    render();
  }
}

window.addEventListener("focus", () => {
  if (!state.pendingMutation) loadBoard();
});

loadBoard();