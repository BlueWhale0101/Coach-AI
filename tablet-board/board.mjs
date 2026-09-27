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
  parseTimeToMinutes,
  visibleAllDayItems,
} from "./calendar-layout.mjs";

const STAGE_DELAY_MS = 5000;

const state = {
  snapshot: null,
  loading: true,
  error: null,
  expandedTaskId: null,
  pendingMutation: null,
  selectedEventId: null,
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
  element.style.setProperty("--category-tint", tint(category.color, alpha));
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
  section.innerHTML = `
    <div class="section-header">
      <div>
        <p class="eyebrow">UPCOMING</p>
        <h1>Household tasks</h1>
      </div>
      <div class="task-count">${state.snapshot.tasks.length}</div>
    </div>
  `;
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
  grid.style.height = `${minutesToPixels(DAY_END_MINUTE)}px`;

  hourLabels().forEach((hour) => {
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
    line.style.top = `${minutesToPixels(minutes)}px`;
    grid.appendChild(line);
  }

  layoutTimedEvents(day.events).forEach((event) => grid.appendChild(renderEventCard(event, day)));
  column.appendChild(grid);
  return column;
}

function renderCalendar() {
  const section = document.createElement("section");
  section.className = "calendar-board";
  section.setAttribute("aria-label", "Calendar");
  section.innerHTML = `
    <div class="section-header calendar-header">
      <div>
        <p class="eyebrow">CALENDAR</p>
        <h1>Today and tomorrow</h1>
      </div>
      <div class="time-range">7 AM-3 PM</div>
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
  scale.style.height = `${minutesToPixels(DAY_END_MINUTE)}px`;
  hourLabels().forEach((hour) => {
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

function setInitialCalendarScroll() {
  const scroller = document.querySelector(".calendar-scroll");
  if (scroller && scroller.scrollTop < 10) {
    scroller.scrollTop = minutesToPixels(parseTimeToMinutes("07:00"));
  }
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
  root.append(renderTasks(), renderCalendar());
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
