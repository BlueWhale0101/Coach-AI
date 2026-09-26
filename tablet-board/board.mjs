import { categories, getBoardSnapshot } from "./data-provider.mjs";
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

const state = {
  snapshot: getBoardSnapshot(),
  expandedTaskId: null,
  completedTask: null,
  selectedEventId: null,
};

const root = document.querySelector("#board-root");
const undoStrip = document.querySelector("#undo-strip");

function categoryFor(id) {
  return categories[id] ?? categories.home;
}

function tint(hex, alpha) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyCategoryVars(element, categoryId, alpha = 0.16) {
  const category = categoryFor(categoryId);
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

function renderTask(task) {
  const card = document.createElement("article");
  card.className = `task-card ${state.expandedTaskId === task.id ? "expanded" : ""} ${task.pinned ? "pinned" : ""}`;
  card.tabIndex = 0;
  applyCategoryVars(card, task.categoryId);

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
    details.innerHTML = `
      <p>${task.description}</p>
      <div class="detail-line"><strong>${categoryFor(task.categoryId).label}</strong><span>${task.tags.map((tag) => `#${tag}`).join(" ")}</span></div>
    `;
    const actions = document.createElement("div");
    actions.className = "task-actions";
    const complete = button("Complete", "solid-button");
    complete.addEventListener("click", (event) => {
      event.stopPropagation();
      completeTask(task.id);
    });
    actions.append(complete, button("Pin"), button("Edit"));
    details.appendChild(actions);
    card.appendChild(details);
  }

  return card;
}

function completeTask(taskId) {
  const task = state.snapshot.tasks.find((item) => item.id === taskId);
  if (!task) return;
  state.completedTask = { task, index: state.snapshot.tasks.indexOf(task) };
  state.snapshot.tasks = state.snapshot.tasks.filter((item) => item.id !== taskId);
  state.expandedTaskId = null;
  render();
  showUndo(task);
}

function showUndo(task) {
  undoStrip.innerHTML = "";
  undoStrip.hidden = false;
  const message = document.createElement("div");
  message.className = "undo-message";
  message.textContent = `✓ ${task.title} completed`;
  const undo = button("UNDO", "undo-button");
  undo.addEventListener("click", () => {
    if (!state.completedTask) return;
    const { task: restored, index } = state.completedTask;
    state.snapshot.tasks.splice(index, 0, restored);
    state.completedTask = null;
    undoStrip.hidden = true;
    render();
  });
  undoStrip.append(message, undo);
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
  state.snapshot.tasks.forEach((task) => list.appendChild(renderTask(task)));
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
    applyCategoryVars(pill, item.categoryId, 0.2);
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
  applyCategoryVars(card, event.categoryId, 0.2);
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
  applyCategoryVars(popover, event.categoryId, 0.16);
  popover.innerHTML = `
    <div>
      <p class="eyebrow">${event.day.label} · ${formatTime(event.start)}</p>
      <h2>${event.title}</h2>
      <p>${event.detail}</p>
      <div class="detail-line"><strong>${categoryFor(event.categoryId).label}</strong><span>${event.location || ""}</span></div>
    </div>
  `;
  const actions = document.createElement("div");
  actions.className = "task-actions";
  actions.append(button("Done", "solid-button"), button("Pin"), button("Edit"));
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

function render() {
  root.innerHTML = "";
  root.append(renderTasks(), renderCalendar());
  requestAnimationFrame(setInitialCalendarScroll);
}

render();
