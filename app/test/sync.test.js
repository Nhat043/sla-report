import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.js";
import { SyncManager } from "../src/sync.js";
test("initial sync loads metadata, feed items, and warm cache", async () => {
  const client = { sites: async () => ({ data: [{ id: 11, timezone: "Asia/Singapore", business_hours: { mon: { open: "08:00", close: "18:00" } } }] }), staff: async () => ({ data: [{ id: 304, name: "Benjamin Tan" }] }), holidays: async () => ({ data: [] }), changes: async () => ({ data: [{ type: "request.created", request: { id: 41210, site_id: 11, status: "pending", priority: "High", created_at: "2026-10-05T00:00:00Z" } }, { type: "event.created", request_id: 41210, event: { id: 1, status: "processing", actor_id: 304, at: 1791159600 } }], next_cursor: "up-to-date", has_more: false }) };
  const store = new Store(); await new SyncManager({ client, store, log: () => {} }).initialSync();
  assert.equal(store.ready, true); assert.equal(store.requests.size, 1); assert.equal(store.events.get(41210).size, 1); assert.equal(store.cache.has(41210), true);
});

test("poll drains feed pages, deduplicates items, and advances the cursor", async () => {
  const store = new Store(); store.ready = true;
  const pages = [{ data: [{ seq: 1, type: "staff.updated", staff: { id: 304, name: "Updated" } }, { seq: 1, type: "staff.updated", staff: { id: 304, name: "Duplicate" } }], next_cursor: "next", has_more: true }, { data: [{ seq: 2, type: "staff.updated", staff: { id: 305, name: "Second page" } }], next_cursor: "head", has_more: false }];
  const manager = new SyncManager({ store, log: () => {}, client: { changes: async () => pages.shift() } });
  await manager.poll();
  assert.equal(store.staff.get(304).name, "Updated"); assert.equal(store.staff.get(305).name, "Second page"); assert.equal(manager.cursor, "head");
});
