import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
function storeFixture() {
  const store = new Store();
  store.putSite({ id: 11, timezone: "Asia/Singapore", business_hours: { mon: { open: "08:00", close: "18:00" } } }); store.putStaff({ id: 304, name: "Benjamin Tan" });
  store.putRequest({ id: 41210, site_id: 11, status: "processing", priority: "High", created_at: "2026-10-05T00:00:00Z" }); store.putEvent(41210, { id: 1, status: "processing", actor_id: 304, at: 1791159600 }); store.ready = true; return store;
}
test("SLA report returns rows and responder summary", async () => {
  const server = createApp({ store: storeFixture() }).listen(0);
  try { await new Promise(resolve => server.once("listening", resolve)); const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sla-report?from=2026-10-05&to=2026-10-05`); const body = await response.json(); assert.equal(response.status, 200); assert.equal(body.requests.length, 1); assert.deepEqual(body.responders, [{ id: 304, name: "Benjamin Tan", requests: 1, within_target: 1, completed_late: 0 }]); } finally { server.close(); }
});
test("SLA report rejects invalid date ranges", async () => {
  const server = createApp({ store: storeFixture() }).listen(0);
  try { await new Promise(resolve => server.once("listening", resolve)); const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sla-report?from=2026-10-06&to=2026-10-05`); assert.equal(response.status, 400); } finally { server.close(); }
});
