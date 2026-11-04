import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";

// Build a store with deterministic SLA facts by injecting the per-request
// cache directly, so filter/sort/validation branches don't depend on the
// business-hours engine.
function storeFixture() {
  const store = new Store();
  store.putSite({ id: 11, timezone: "Asia/Singapore", business_hours: {} }, [{ date: "05/10/2026", name: "Test holiday" }]);
  store.putSite({ id: 12, timezone: "Australia/Sydney", business_hours: {} });
  store.putStaff({ id: 304, name: "Benjamin Tan" });
  store.putStaff({ id: 305, name: "Chloe Lim" });

  const rows = [
    { id: 1, site_id: 11, facts: { responder_id: 304, response_business_minutes: 10, within_target: true, completed_late: false } },
    { id: 2, site_id: 11, facts: { responder_id: 304, response_business_minutes: 50, within_target: false, completed_late: true } },
    { id: 3, site_id: 12, facts: { responder_id: null, response_business_minutes: null, within_target: null, completed_late: null } },
    { id: 4, site_id: 12, facts: { responder_id: 305, response_business_minutes: 30, within_target: true, completed_late: true } },
  ];
  for (const { id, site_id, facts } of rows) {
    store.putRequest({ id, site_id, status: "pending", priority: "Low", created_at: "2026-10-05T00:00:00Z" });
    store.cache.set(id, facts); // putRequest cleared it; set after
  }
  store.ready = true;
  return store;
}

// Start the app on an ephemeral port and return a fetch helper plus a closer.
async function withApp(store, run) {
  const server = createApp({ store }).listen(0);
  try {
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    await run((path) => fetch(base + path));
  } finally {
    server.close();
  }
}

const RANGE = "from=2026-10-05&to=2026-10-05";

test("requests endpoint rejects invalid queries with 400", async () => {
  await withApp(storeFixture(), async get => {
    const bad = [
      "/api/requests",                              // missing range
      `/api/requests?from=2026-10-06&to=2026-10-05`, // from after to
      `/api/requests?${RANGE}&limit=0`,
      `/api/requests?${RANGE}&limit=201`,
      `/api/requests?${RANGE}&limit=abc`,
      `/api/requests?${RANGE}&sort=bogus`,
      `/api/requests?${RANGE}&late=maybe`,
      `/api/requests?${RANGE}&within_target=maybe`,
      `/api/requests?${RANGE}&site_id=x`,
      `/api/requests?${RANGE}&responder_id=x`,
      `/api/requests?${RANGE}&cursor=not-a-real-cursor`,
    ];
    for (const path of bad) {
      assert.equal((await get(path)).status, 400, `expected 400 for ${path}`);
    }
  });
});

test("requests endpoint ignores unknown params", async () => {
  await withApp(storeFixture(), async get => {
    const res = await get(`/api/requests?${RANGE}&whatever=1`);
    assert.equal(res.status, 200);
  });
});

test("requests endpoint applies each filter", async () => {
  await withApp(storeFixture(), async get => {
    const ids = async query => (await (await get(`/api/requests?${RANGE}&${query}&limit=200`)).json()).data.map(r => r.id);
    assert.deepEqual(await ids("site_id=12"), [3, 4]);
    assert.deepEqual(await ids("responder_id=304"), [1, 2]);
    assert.deepEqual(await ids("late=true"), [2, 4]);
    assert.deepEqual(await ids("late=false"), [1]);
    assert.deepEqual(await ids("within_target=true"), [1, 4]);
    assert.deepEqual(await ids("within_target=false"), [2]);
  });
});

test("requests endpoint sorts, with nulls last", async () => {
  await withApp(storeFixture(), async get => {
    const ids = async query => (await (await get(`/api/requests?${RANGE}&${query}&limit=200`)).json()).data.map(r => r.id);
    assert.deepEqual(await ids("sort=-id"), [4, 3, 2, 1]);
    // ascending by minutes: 10, 30, 50, then null (id 3) last
    assert.deepEqual(await ids("sort=response_business_minutes"), [1, 4, 2, 3]);
    // descending by minutes: 50, 30, 10, null last
    assert.deepEqual(await ids("sort=-response_business_minutes"), [2, 4, 1, 3]);
  });
});

test("sla-report groups responders and rejects a bad range", async () => {
  await withApp(storeFixture(), async get => {
    assert.equal((await get("/api/sla-report?from=2026-10-06&to=2026-10-05")).status, 400);

    const report = await (await get(`/api/sla-report?${RANGE}`)).json();
    assert.equal(report.requests.length, 4);
    const benjamin = report.responders.find(r => r.id === 304);
    assert.deepEqual(benjamin, { id: 304, name: "Benjamin Tan", requests: 2, within_target: 1, completed_late: 1 });
    // the no-responder row (id 3) is excluded from the summary
    assert.equal(report.responders.length, 2);
  });
});

test("report excludes canceled, deleted, merged and out-of-range requests", async () => {
  const store = storeFixture();
  // One of each exclusion (rule 1), all otherwise in range.
  store.putRequest({ id: 10, site_id: 11, status: "canceled", created_at: "2026-10-05T00:00:00Z" });
  store.putRequest({ id: 11, site_id: 11, status: "pending", deleted_at: "2026-10-05T01:00:00Z", created_at: "2026-10-05T00:00:00Z" });
  store.putRequest({ id: 12, site_id: 11, status: "pending", merged_into_id: 1, created_at: "2026-10-05T00:00:00Z" });
  store.putRequest({ id: 13, site_id: 11, status: "pending", created_at: "2026-09-01T00:00:00Z" }); // out of range
  store.putRequest({ id: 14, site_id: 99, status: "pending", created_at: "2026-10-05T00:00:00Z" }); // unknown site
  await withApp(store, async get => {
    const ids = (await (await get(`/api/requests?${RANGE}&limit=200`)).json()).data.map(r => r.id);
    assert.deepEqual(ids, [1, 2, 3, 4]); // none of 10-14 appear
  });
});

test("CSV export returns the filtered rows with a header", async () => {
  await withApp(storeFixture(), async get => {
    const res = await get(`/api/requests.csv?${RANGE}&responder_id=304&sort=id`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/csv/);
    assert.match(res.headers.get("content-disposition"), /attachment; filename=/);
    const lines = (await res.text()).trim().split("\r\n");
    assert.equal(lines[0], "id,site_id,responder_id,responder,response_business_minutes,within_target,completed_late");
    assert.deepEqual(lines.slice(1), [
      "1,11,304,Benjamin Tan,10,true,false",
      "2,11,304,Benjamin Tan,50,false,true",
    ]);
  });
});

test("CSV export leaves null fields empty", async () => {
  await withApp(storeFixture(), async get => {
    const res = await get(`/api/requests.csv?${RANGE}&site_id=12&sort=id`);
    const lines = (await res.text()).trim().split("\r\n");
    // id 3 has no responder: those columns are empty.
    assert.deepEqual(lines.slice(1), [
      "3,12,,,,,",
      "4,12,305,Chloe Lim,30,true,true",
    ]);
  });
});

test("CSV export rejects a bad range and honours readiness", async () => {
  await withApp(storeFixture(), async get => {
    assert.equal((await get("/api/requests.csv?from=2026-10-06&to=2026-10-05")).status, 400);
    assert.equal((await get(`/api/requests.csv?${RANGE}&sort=bogus`)).status, 400);
  });
  const store = storeFixture();
  store.ready = false;
  await withApp(store, async get => {
    assert.equal((await get(`/api/requests.csv?${RANGE}`)).status, 503);
  });
});

test("endpoints return 503 before the store is ready", async () => {
  const store = storeFixture();
  store.ready = false;
  await withApp(store, async get => {
    assert.equal((await get(`/api/sla-report?${RANGE}`)).status, 503);
    assert.equal((await get(`/api/requests?${RANGE}`)).status, 503);
    assert.equal((await get("/ready")).status, 503);
  });
});
