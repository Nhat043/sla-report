import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
function storeFixture() { const store = new Store(); store.putSite({ id: 11, timezone: "Asia/Singapore", business_hours: { mon: { open: "08:00", close: "18:00" } } }); for (const id of [1, 2, 3]) { store.putRequest({ id, site_id: 11, status: "pending", priority: "Low", created_at: "2026-10-05T00:00:00Z" }); } store.ready = true; return store; }
test("browse API uses an opaque snapshot cursor", async () => { const server = createApp({ store: storeFixture() }).listen(0); try { await new Promise(resolve => server.once("listening", resolve)); const url = `http://127.0.0.1:${server.address().port}/api/requests?from=2026-10-05&to=2026-10-05&limit=2`; const first = await (await fetch(url)).json(); assert.deepEqual(first.data.map(row => row.id), [1, 2]); const second = await (await fetch(`${url}&cursor=${first.next_cursor}`)).json(); assert.deepEqual(second.data.map(row => row.id), [3]); assert.equal(second.next_cursor, null); } finally { server.close(); } });
