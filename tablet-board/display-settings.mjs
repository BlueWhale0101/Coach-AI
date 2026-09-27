export const DISPLAY_SETTINGS_KEY = "assistant.tabletBoard.displaySettings.v1";

export const DEFAULT_DISPLAY_SETTINGS = Object.freeze({
  textScale: 100,
  taskSplitPercent: 36,
  visibleHours: 8,
  startHour: 7,
  todayWidthPercent: 62,
  categoryTint: "medium",
});

export const CATEGORY_TINT_ALPHA = Object.freeze({
  low: 0.1,
  medium: 0.16,
  strong: 0.24,
});

export const VISIBLE_HOUR_OPTIONS = Object.freeze([6, 8, 10, 12]);

const LIMITS = Object.freeze({
  textScale: [85, 130],
  taskSplitPercent: [30, 48],
  startHour: [0, 18],
  todayWidthPercent: [55, 72],
});

function clampNumber(value, [min, max], fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function roundTo(value, decimals) {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function normalizeDisplaySettings(value = {}) {
  const visibleHours = Number(value.visibleHours);
  const categoryTint = CATEGORY_TINT_ALPHA[value.categoryTint] ? value.categoryTint : DEFAULT_DISPLAY_SETTINGS.categoryTint;

  return {
    textScale: Math.round(clampNumber(value.textScale, LIMITS.textScale, DEFAULT_DISPLAY_SETTINGS.textScale)),
    taskSplitPercent: roundTo(clampNumber(value.taskSplitPercent, LIMITS.taskSplitPercent, DEFAULT_DISPLAY_SETTINGS.taskSplitPercent), 1),
    visibleHours: VISIBLE_HOUR_OPTIONS.includes(visibleHours) ? visibleHours : DEFAULT_DISPLAY_SETTINGS.visibleHours,
    startHour: Math.round(clampNumber(value.startHour, LIMITS.startHour, DEFAULT_DISPLAY_SETTINGS.startHour)),
    todayWidthPercent: Math.round(clampNumber(value.todayWidthPercent, LIMITS.todayWidthPercent, DEFAULT_DISPLAY_SETTINGS.todayWidthPercent)),
    categoryTint,
  };
}

export function loadDisplaySettings(storage = globalThis.localStorage) {
  if (!storage) return { ...DEFAULT_DISPLAY_SETTINGS };
  try {
    const raw = storage.getItem(DISPLAY_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS };
    return normalizeDisplaySettings({ ...DEFAULT_DISPLAY_SETTINGS, ...JSON.parse(raw) });
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

export function saveDisplaySettings(settings, storage = globalThis.localStorage) {
  const normalized = normalizeDisplaySettings(settings);
  try {
    if (storage) storage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // Display settings are local presentation preferences; failing to persist should not break the board.
  }
  return normalized;
}

export function resetDisplaySettings(storage = globalThis.localStorage) {
  try {
    if (storage) storage.removeItem(DISPLAY_SETTINGS_KEY);
  } catch {
    // Keep the visual reset even if storage cleanup is unavailable.
  }
  return { ...DEFAULT_DISPLAY_SETTINGS };
}

export function tintAlpha(settings, base = CATEGORY_TINT_ALPHA.medium) {
  const scale = CATEGORY_TINT_ALPHA[settings.categoryTint] ?? CATEGORY_TINT_ALPHA.medium;
  return Math.min(0.32, Math.max(0.06, base * (scale / CATEGORY_TINT_ALPHA.medium)));
}

export function pixelsPerHourFor(settings, basePixelsPerHour = 84) {
  const normalized = normalizeDisplaySettings(settings);
  return Math.round((basePixelsPerHour * DEFAULT_DISPLAY_SETTINGS.visibleHours) / normalized.visibleHours);
}