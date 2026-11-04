import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateRange(query) { const { from, to } = query; return DATE.test(from || "") && DATE.test(to || "") && from <= to ? { from, to } : null; }
function bool(value) { return value === undefined ? undefined : value === "true" ? true : value === "false" ? false : null; }
function sortRows(rows, sort) {
  const descending = sort.startsWith("-"); const field = sort.replace("-", "");
  return rows.sort((a, b) => { const left = a[field], right = b[field]; if (left == null || right == null) return left == null && right == null ? a.id - b.id : left == null ? 1 : -1; if (left === right) return a.id - b.id; return (left < right ? -1 : 1) * (descending ? -1 : 1); });
}

export function createApp({ store = new Store(), ready = false } = {}) {
  const app = express();

  app.use(express.static(path.join(here, "..", "public")));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/ready", (req, res) => {
    res.status(ready || store.ready ? 200 : 503).json({ ready: Boolean(ready || store.ready) });
  });

  app.get("/api/requests", (req, res) => {
    if (!(ready || store.ready)) return res.status(503).json({ error: "not ready" });
    const range = dateRange(req.query); const limit = req.query.limit === undefined ? 50 : Number(req.query.limit); const sort = req.query.sort || "id";
    const late = bool(req.query.late); const withinTarget = bool(req.query.within_target);
    if (!range || !Number.isInteger(limit) || limit < 1 || limit > 200 || !["id", "-id", "response_business_minutes", "-response_business_minutes"].includes(sort) || (req.query.late !== undefined && late === null) || (req.query.within_target !== undefined && withinTarget === null) || (req.query.site_id && !/^\d+$/.test(req.query.site_id)) || (req.query.responder_id && !/^\d+$/.test(req.query.responder_id))) return res.status(400).json({ error: "invalid query" });
    let rows; let offset = 0;
    if (req.query.cursor) {
      const snapshot = store.snapshots.get(req.query.cursor);
      if (!snapshot || snapshot.expires < Date.now()) return res.status(400).json({ error: "invalid cursor" });
      rows = snapshot.rows; offset = snapshot.offset;
    } else {
      rows = store.report(range.from, range.to).filter(row => (!req.query.site_id || row.site_id === Number(req.query.site_id)) && (!req.query.responder_id || row.responder_id === Number(req.query.responder_id)) && (late === undefined || row.completed_late === late) && (withinTarget === undefined || row.within_target === withinTarget));
      sortRows(rows, sort);
    }
    const data = rows.slice(offset, offset + limit); const nextOffset = offset + data.length; let next_cursor = null;
    if (nextOffset < rows.length) { next_cursor = crypto.randomUUID(); store.snapshots.set(next_cursor, { rows, offset: nextOffset, expires: Date.now() + 10 * 60_000 }); }
    res.json({ data, next_cursor });
  });

  app.get("/api/sla-report", (req, res) => {
    if (!(ready || store.ready)) return res.status(503).json({ error: "not ready" });
    const range = dateRange(req.query); if (!range) return res.status(400).json({ error: "invalid date range" });
    const requests = store.report(range.from, range.to); const groups = new Map();
    for (const row of requests) if (row.responder_id != null) { const group = groups.get(row.responder_id) || { id: row.responder_id, name: row.responder, requests: 0, within_target: 0, completed_late: 0 }; group.requests += 1; if (row.within_target) group.within_target += 1; if (row.completed_late) group.completed_late += 1; groups.set(row.responder_id, group); }
    res.json({ ...range, requests, responders: [...groups.values()] });
  });

  return app;
}
