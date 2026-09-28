export function createPhoneLoader({ state, services, getResults, renderResults, empty, shiftDay }) {
  return async function load() {
    const request = ++state.request;
    const route = state.route;
    const results = getResults();
    if (results) results.setAttribute("aria-busy", "true");
    try {
      let data;
      if (route === "today") data = await services.getPhoneTodaySnapshot();
      else if (route === "tasks") data = await services.listTaskView({ query: state.query.tasks, status: state.status === "all" ? "" : state.status, categoryId: state.category.tasks, tagId: state.tag ?? "" });
      else if (route === "knowledge") data = await services.listKnowledgeView({ query: state.query.knowledge, categoryId: state.category.knowledge });
      else data = await services.listWeekEvents({ weekStart: state.day, weekEnd: shiftDay(state.day, 1) });
      if (request !== state.request || route !== state.route) return;
      if (route === "today") state.snapshot = data;
      else state.items = data;
      renderResults();
    } catch (error) {
      if (request === state.request && route === state.route && results) results.replaceChildren(empty(error.message || "Could not load Assistant.AI."));
    } finally {
      if (request === state.request && route === state.route) results?.removeAttribute("aria-busy");
    }
  };
}
