import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createClassificationHandler, CLASSIFICATION_OPERATIONS } from "../supabase/functions/_shared/classification-api.mjs";
import { SupabaseClassificationRepository } from "../supabase/functions/_shared/supabase-classification-repository.mjs";
import { createAttentionHandler, ATTENTION_OPERATIONS } from "../supabase/functions/_shared/attention-api.mjs";
import { SupabaseAttentionRepository } from "../supabase/functions/_shared/supabase-attention-repository.mjs";

const id = "a783830e-4302-4ac8-8269-22c12405e717";
const other = "98a26f5f-91ba-4fd0-a65e-fc638b19b5d2";
const category = { object_id: id, name: "Home", color: "#ABCDEF", sort_order: 1, status: "active" };
const tag = { object_id: other, name: "Errand", status: "active" };
const classification = { target_object_id: id, category, tags: [tag] };
const pin = { target_object_id: id, pinned_at: "2026-09-26T00:00:00Z" };
const req = (body, secret = "secret", method = "POST") => new Request("http://localhost", {
  method, headers: { "x-action-secret": secret, "content-type": "application/json" },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
const classCall = async (operation, body, repository, secret) => {
  const response = await createClassificationHandler({ operation, repository, actionSecret: "secret" })(req(body, secret));
  return [response.status, await response.json()];
};
const attentionCall = async (operation, body, repository, secret) => {
  const response = await createAttentionHandler({ operation, repository, actionSecret: "secret" })(req(body, secret));
  return [response.status, await response.json()];
};

test("classification endpoints validate, route, envelope and page", async () => {
  const seen = [];
  const repository = {
    createCategory: async v => { seen.push(["createCategory", v]); return category; },
    updateCategory: async (...v) => { seen.push(["updateCategory", ...v]); return category; },
    archiveCategory: async v => { seen.push(["archiveCategory", v]); return category; },
    getCategory: async v => { seen.push(["getCategory", v]); return category; },
    listCategories: async v => { seen.push(["listCategories", v]); return { rows: [category], hasMore: true }; },
    setObjectCategory: async (...v) => { seen.push(["setObjectCategory", ...v]); return classification; },
    clearObjectCategory: async v => { seen.push(["clearObjectCategory", v]); return { ...classification, category: null }; },
    createTag: async v => { seen.push(["createTag", v]); return tag; },
    updateTag: async (...v) => { seen.push(["updateTag", ...v]); return tag; },
    archiveTag: async v => { seen.push(["archiveTag", v]); return tag; },
    getTag: async v => { seen.push(["getTag", v]); return tag; },
    listTags: async v => { seen.push(["listTags", v]); return { rows: [tag], hasMore: false }; },
    addObjectTag: async (...v) => { seen.push(["addObjectTag", ...v]); return classification; },
    removeObjectTag: async (...v) => { seen.push(["removeObjectTag", ...v]); return { ...classification, tags: [] }; },
    getObjectClassification: async v => { seen.push(["getObjectClassification", v]); return classification; },
    listCategoryMembers: async (...v) => { seen.push(["listCategoryMembers", ...v]); return { rows: [{ target_object_id: id }], hasMore: false }; },
    listTagMembers: async (...v) => { seen.push(["listTagMembers", ...v]); return { rows: [{ target_object_id: id }], hasMore: true }; },
  };
  for (const [operation, input, key] of [
    ["create_category", { name: " Home ", color: "#abcdef", sort_order: 1 }, "category"],
    ["update_category", { object_id: id, name: "New", color: "#123456", sort_order: 2 }, "category"],
    ["archive_category", { object_id: id }, "category"],
    ["get_category", { object_id: id }, "category"],
    ["set_object_category", { target_object_id: id, category_object_id: other }, "classification"],
    ["clear_object_category", { target_object_id: id }, "classification"],
    ["create_tag", { name: " Errand " }, "tag"],
    ["update_tag", { object_id: other, name: "Out" }, "tag"],
    ["archive_tag", { object_id: other }, "tag"],
    ["get_tag", { object_id: other }, "tag"],
    ["add_object_tag", { target_object_id: id, tag_object_id: other }, "classification"],
    ["remove_object_tag", { target_object_id: id, tag_object_id: other }, "classification"],
    ["get_object_classification", { target_object_id: id }, "classification"],
  ]) {
    const [status, body] = await classCall(operation, input, repository);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.data[key]);
  }
  assert.deepEqual(seen[0], ["createCategory", { name: "Home", color: "#ABCDEF", sort_order: 1 }]);
  assert.deepEqual(seen[1], ["updateCategory", id, { name: "New", color: "#123456", sort_order: 2 }]);
  const [listStatus, list] = await classCall("list_categories", { status: "active", limit: 1, offset: 2 }, repository);
  assert.equal(listStatus, 200);
  assert.deepEqual(list.data, { categories: [category], limit: 1, offset: 2, count: 1, has_more: true });
  const [tagsStatus, tags] = await classCall("list_tags", { status: "archived" }, repository);
  assert.equal(tagsStatus, 200);
  assert.equal(tags.data.tags[0].object_id, other);
  const [membersStatus, members] = await classCall("list_tag_members", { tag_object_id: other, limit: 1 }, repository);
  assert.equal(membersStatus, 200);
  assert.equal(members.data.has_more, true);
});

test("classification auth, validation and safe errors", async () => {
  const repository = { getCategory: async () => category };
  assert.deepEqual(await classCall("get_category", { object_id: id }, repository, "wrong"),
    [401, { ok: false, error: "Unauthorized", code: "UNAUTHORIZED", details: {} }]);
  for (const [operation, input, code] of [
    ["create_category", { name: " ", color: "#000000" }, "VALIDATION_ERROR"],
    ["create_category", { name: "x", color: "blue" }, "VALIDATION_ERROR"],
    ["update_category", { object_id: id }, "MISSING_REQUIRED_FIELD"],
    ["update_tag", { object_id: id, color: "#000000" }, "IMMUTABLE_FIELD"],
    ["list_categories", { limit: 101 }, "INVALID_PAGINATION"],
    ["set_object_category", { target_object_id: id, category_object_id: "bad" }, "INVALID_OBJECT_ID"],
  ]) {
    const [status, body] = await classCall(operation, input, repository);
    assert.equal(status, 400);
    assert.equal(body.code, code);
  }
  const [status, body] = await classCall("get_category", { object_id: id }, { getCategory: () => { throw new Error("secret internals"); } });
  assert.equal(status, 500);
  assert.equal(body.code, "DATABASE_ERROR");
  assert.doesNotMatch(JSON.stringify(body), /secret internals/);
});

test("attention endpoints validate, route, envelope and page", async () => {
  const seen = [];
  const repository = {
    pin: async v => { seen.push(["pin", v]); return pin; },
    unpin: async v => { seen.push(["unpin", v]); return { target_object_id: v, pinned: false, pinned_at: null }; },
    isPinned: async v => { seen.push(["isPinned", v]); return { ...pin, pinned: true }; },
    list: async v => { seen.push(["list", v]); return { rows: [pin], hasMore: true }; },
  };
  assert.equal((await attentionCall("pin_object", { target_object_id: id }, repository))[1].data.pin.target_object_id, id);
  assert.equal((await attentionCall("unpin_object", { target_object_id: id }, repository))[1].data.pin.pinned, false);
  assert.equal((await attentionCall("is_object_pinned", { target_object_id: id }, repository))[1].data.pin.pinned, true);
  const [status, body] = await attentionCall("list_pinned_objects", { limit: 1, offset: 2 }, repository);
  assert.equal(status, 200);
  assert.deepEqual(body.data, { pins: [pin], limit: 1, offset: 2, count: 1, has_more: true });
  assert.deepEqual(seen, [["pin", id], ["unpin", id], ["isPinned", id], ["list", { limit: 1, offset: 2 }]]);
  assert.equal((await attentionCall("pin_object", { target_object_id: "bad" }, repository))[1].code, "INVALID_OBJECT_ID");
  assert.equal((await attentionCall("list_pinned_objects", { offset: 10001 }, repository))[1].code, "INVALID_PAGINATION");
});

test("repositories map RPCs, ranges and safe database failures", async () => {
  const calls = [];
  const rpc = async (name, params) => { calls.push([name, params]); return { data: name.includes("list") ? [pin, pin] : [category], error: null }; };
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: (field, order) => { calls.push(["order", field, order]); return chain; },
    range: (start, end) => { calls.push(["range", start, end]); return Promise.resolve({ data: [category, category], error: null }); },
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  const classificationRepo = new SupabaseClassificationRepository({ rpc, from: table => { calls.push(["from", table]); return chain; } });
  await classificationRepo.createCategory({ name: "Home", color: "#000000", sort_order: 0 });
  assert.deepEqual(calls[0], ["assistant_create_category", { p_name: "Home", p_color: "#000000", p_sort_order: 0 }]);
  assert.deepEqual(await classificationRepo.listCategories({ limit: 1, offset: 3 }), { rows: [category], hasMore: true });
  assert.ok(calls.some(x => x[0] === "range" && x[1] === 3 && x[2] === 4));
  await assert.rejects(() => classificationRepo.getCategory(id), error => error.code === "CATEGORY_NOT_FOUND");
  const attentionRepo = new SupabaseAttentionRepository({ rpc });
  assert.deepEqual(await attentionRepo.list({ limit: 1, offset: 2 }), { rows: [pin], hasMore: true });
  assert.deepEqual(calls.at(-1), ["assistant_list_pinned_objects", { p_limit: 2, p_offset: 2 }]);
  const bad = new SupabaseAttentionRepository({ rpc: async () => ({ data: null, error: { code: "23503", message: "secret target detail" } }) });
  await assert.rejects(() => bad.pin(id), error => error.code === "TARGET_NOT_FOUND" && !/secret/.test(error.message));
});

test("configuration declares every Classification and Attention function", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const dirs = await readdir(new URL("../supabase/functions/", import.meta.url));
  for (const operation of CLASSIFICATION_OPERATIONS) {
    const name = operation.replaceAll("_", "-");
    assert.ok(dirs.includes(name));
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt\\s*=\\s*false`));
    assert.match(await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8"), new RegExp(`serveClassificationOperation\\("${operation}"\\)`));
  }
  for (const operation of ATTENTION_OPERATIONS) {
    const name = operation.replaceAll("_", "-");
    assert.ok(dirs.includes(name));
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*verify_jwt\\s*=\\s*false`));
    assert.match(await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), "utf8"), new RegExp(`serveAttentionOperation\\("${operation}"\\)`));
  }
});
