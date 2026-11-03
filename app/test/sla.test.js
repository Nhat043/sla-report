import { test } from "node:test";
import assert from "node:assert/strict";
import { businessSeconds } from "../src/business-time.js";
import { activeEvents, calculate } from "../src/sla.js";
const site = { timezone: "Asia/Singapore", business_hours: { mon: { open: "08:00", close: "18:00" }, tue: { open: "08:00", close: "18:00" }, wed: { open: "08:00", close: "18:00" }, thu: { open: "08:00", close: "18:00" }, fri: { open: "08:00", close: "18:00" } } };
test("business time excludes closed hours and holidays", () => assert.equal(businessSeconds(Date.parse("2026-10-05T08:00:00Z"), Date.parse("2026-10-06T02:00:00Z"), site, new Set(["2026-10-06"])), 7200));
test("reverting event and target event are both ignored", () => assert.deepEqual(activeEvents([{ id: 1, status: "processing" }, { id: 2, reverts_id: 1 }]), []));
test("SLA uses first human response and latest deadline", () => {
  const result = calculate({ created_at: "2026-10-05T00:00:00Z", priority: "High" }, [{ id: 1, status: "processing", actor_id: null, at: 1791159000 }, { id: 2, status: "processing", actor_id: 9, at: 1791159600, due_at: "05/10/2026 12:00" }, { id: 3, status: "complete", at: 1791174000 }], site, new Set());
  assert.deepEqual(result, { responder_id: 9, response_business_minutes: 20, within_target: true, completed_late: true });
});
