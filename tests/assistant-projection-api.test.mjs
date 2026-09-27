import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createProjectionHandler, ProjectionApiError } from "../supabase/functions/_shared/projection-api.mjs";
import { SupabaseProjectionRepository } from "../supabase/functions/_shared/supabase-projection-repository.mjs";

const board = { metadata: { timezone: "Australia/Darwin" }, tasks: [], days: [] };
const repository = {
  calls: [],
  async getHouseholdBoard(options) {
    this.calls.push(options);
    return board;
  },
};

const request = (body, secret = "secret", method = "POST") => new Request("http://localhost", {
  method,
  headers: { "content-type": "application/json", "x-action-secret": secret },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});

async function call(body, repo = repository, secret = "secret") {
  const result = await createProjectionHandler({ repository: repo, actionSecret: "secret" })(request(body, secret));
  return [result.status, await result.json()];
}

test("get-household-board uses stable envelopes and validates bounded inputs", async () => {
  const [status, body] = await call({ display_date: "2026-09-27", timezone: "Australia/Darwin", now: "2026-09-27T07:30:00+09:30", task_limit: 12 });
  assert.equal(status, 200);
  assert.deepEqual(body, { ok: true, data: { board } });
  assert.deepEqual(repository.calls.at(-1), {
    display_date: "2026-09-27",
    timezone: "Australia/Darwin",
    now: "2026-09-27T07:30:00+09:30",
    task_limit: 12,
  });

  for (const [input, code] of [
    [{ display_date: "2026-02-30" }, "INVALID_DATE"],
    [{ now: "2026-09-27T07:30:00" }, "INVALID_TIMESTAMP"],
    [{ timezone: " " }, "VALIDATION_ERROR"],
    [{ task_limit: 51 }, "INVALID_PAGINATION"],
    [{ extra: true }, "IMMUTABLE_FIELD"],
  ]) {
    const [badStatus, badBody] = await call(input);
    assert.equal(badStatus, 400);
    assert.equal(badBody.code, code);
  }
});

test("projection authentication, method handling, repository errors, and config registration", async () => {
  assert.equal((await call({}, repository, "wrong"))[0], 401);
  const handler = createProjectionHandler({ repository, actionSecret: "secret" });
  assert.equal((await handler(request({}, "secret", "OPTIONS"))).status, 200);
  assert.equal((await handler(request({}, "secret", "GET"))).status, 405);
  const invalid = await handler(new Request("http://localhost", { method: "POST", headers: { "x-action-secret": "secret" }, body: "{" }));
  assert.equal((await invalid.json()).code, "INVALID_JSON");

  const failing = { getHouseholdBoard: async () => { throw new ProjectionApiError("INVALID_TIMEZONE", "timezone must be valid"); } };
  const [status, body] = await call({}, failing);
  assert.equal(status, 400);
  assert.equal(body.code, "INVALID_TIMEZONE");

  const repo = new SupabaseProjectionRepository({ rpc: async (name, args) => ({ data: board, error: null, name, args }) });
  assert.deepEqual(await repo.getHouseholdBoard({ display_date: null, timezone: "Australia/Darwin", now: null, task_limit: 15 }), board);

  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  assert.match(config, /\[functions\.get-household-board\]\s*verify_jwt\s*=\s*false/);
});
