import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Parse and validate the shared from/to date range. Returns null if either
// date is missing/malformed, or if from is after to.
function dateRange(query) {
  const { from, to } = query;
  if (!DATE.test(from || "") || !DATE.test(to || "") || from > to) return null;
  return { from, to };
}

// Tri-state boolean query param: undefined (absent), true, false, or null (invalid).
function bool(value) {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

// Sort rows in place. Nulls always sort last; ties (including null vs null)
// break by id ascending.
function sortRows(rows, sort) {
  const descending = sort.startsWith("-");
  const field = sort.replace("-", "");
  return rows.sort((a, b) => {
    const left = a[field];
    const right = b[field];
    if (left == null || right == null) {
      if (left == null && right == null) return a.id - b.id;
      return left == null ? 1 : -1;
    }
    if (left === right) return a.id - b.id;
    return (left < right ? -1 : 1) * (descending ? -1 : 1);
  });
}

export function createApp({ store = new Store(), ready = false } = {}) {
  const app = express();
  const isReady = () => ready || store.ready;

  app.use(express.static(path.join(here, "..", "public")));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/ready", (req, res) => {
    res.status(isReady() ? 200 : 503).json({ ready: isReady() });
  });

  app.get("/api/requests", (req, res) => {
    if (!isReady()) return res.status(503).json({ error: "not ready" });

    const range = dateRange(req.query);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    const sort = req.query.sort || "id";
    const late = bool(req.query.late);
    const withinTarget = bool(req.query.within_target);

    const validSorts = ["id", "-id", "response_business_minutes", "-response_business_minutes"];
    const invalid =
      !range ||
      !Number.isInteger(limit) || limit < 1 || limit > 200 ||
      !validSorts.includes(sort) ||
      (req.query.late !== undefined && late === null) ||
      (req.query.within_target !== undefined && withinTarget === null) ||
      (req.query.site_id && !/^\d+$/.test(req.query.site_id)) ||
      (req.query.responder_id && !/^\d+$/.test(req.query.responder_id));
    if (invalid) return res.status(400).json({ error: "invalid query" });

    let rows;
    let offset = 0;
    if (req.query.cursor) {
      // Continue a previous walk from its frozen snapshot, so a row that exists
      // for the whole walk appears exactly once even if the data changes.
      const snapshot = store.snapshots.get(req.query.cursor);
      if (!snapshot || snapshot.expires < Date.now()) {
        return res.status(400).json({ error: "invalid cursor" });
      }
      rows = snapshot.rows;
      offset = snapshot.offset;
    } else {
      // First page: compute, filter and sort the full result set.
      rows = store.report(range.from, range.to).filter(row =>
        (!req.query.site_id || row.site_id === Number(req.query.site_id)) &&
        (!req.query.responder_id || row.responder_id === Number(req.query.responder_id)) &&
        (late === undefined || row.completed_late === late) &&
        (withinTarget === undefined || row.within_target === withinTarget));
      sortRows(rows, sort);
    }

    const data = rows.slice(offset, offset + limit);
    const nextOffset = offset + data.length;
    let next_cursor = null;
    if (nextOffset < rows.length) {
      next_cursor = randomUUID();
      store.snapshots.set(next_cursor, { rows, offset: nextOffset, expires: Date.now() + 10 * 60_000 });
    }
    res.json({ data, next_cursor });
  });

  app.get("/api/sla-report", (req, res) => {
    if (!isReady()) return res.status(503).json({ error: "not ready" });

    const range = dateRange(req.query);
    if (!range) return res.status(400).json({ error: "invalid date range" });

    const requests = store.report(range.from, range.to);

    // One summary row per responder: count requests, within-target and late.
    const groups = new Map();
    for (const row of requests) {
      if (row.responder_id == null) continue;
      let group = groups.get(row.responder_id);
      if (!group) {
        group = { id: row.responder_id, name: row.responder, requests: 0, within_target: 0, completed_late: 0 };
        groups.set(row.responder_id, group);
      }
      group.requests += 1;
      if (row.within_target) group.within_target += 1;
      if (row.completed_late) group.completed_late += 1;
    }

    res.json({ ...range, requests, responders: [...groups.values()] });
  });

  return app;
}
