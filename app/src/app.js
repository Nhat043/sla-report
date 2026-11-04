import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Store } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_SORTS = ["id", "-id", "response_business_minutes", "-response_business_minutes"];
const ROW_FIELDS = ["id", "site_id", "responder_id", "responder", "response_business_minutes", "within_target", "completed_late"];

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

// Parse the filter/sort params shared by the browse and CSV endpoints.
function listParams(query) {
  return {
    range: dateRange(query),
    sort: query.sort || "id",
    late: bool(query.late),
    withinTarget: bool(query.within_target),
  };
}

// Validate the shared filter/sort params. Returns true if the query is invalid.
function listParamsInvalid(query, { range, sort, late, withinTarget }) {
  return (
    !range ||
    !VALID_SORTS.includes(sort) ||
    (query.late !== undefined && late === null) ||
    (query.within_target !== undefined && withinTarget === null) ||
    (query.site_id && !/^\d+$/.test(query.site_id)) ||
    (query.responder_id && !/^\d+$/.test(query.responder_id))
  );
}

// Compute the full filtered and sorted result set for a query (no paging).
function filterSort(store, query, { range, sort, late, withinTarget }) {
  const rows = store.report(range.from, range.to).filter(row =>
    (!query.site_id || row.site_id === Number(query.site_id)) &&
    (!query.responder_id || row.responder_id === Number(query.responder_id)) &&
    (late === undefined || row.completed_late === late) &&
    (withinTarget === undefined || row.within_target === withinTarget));
  sortRows(rows, sort);
  return rows;
}

// RFC 4180 CSV cell: empty for null/undefined; quote and escape when needed.
function csvCell(value) {
  if (value == null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const lines = [ROW_FIELDS.join(",")];
  for (const row of rows) lines.push(ROW_FIELDS.map(field => csvCell(row[field])).join(","));
  return lines.join("\r\n") + "\r\n";
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

    const params = listParams(req.query);
    const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
    if (listParamsInvalid(req.query, params) || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return res.status(400).json({ error: "invalid query" });
    }

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
      rows = filterSort(store, req.query, params);
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

  // CSV download for finance: the same filters and sort as the browse view,
  // but the whole result set (no paging) as a spreadsheet-friendly file.
  app.get("/api/requests.csv", (req, res) => {
    if (!isReady()) return res.status(503).json({ error: "not ready" });

    const params = listParams(req.query);
    if (listParamsInvalid(req.query, params)) return res.status(400).json({ error: "invalid query" });

    const rows = filterSort(store, req.query, params);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="requests_${params.range.from}_${params.range.to}.csv"`);
    res.send(toCsv(rows));
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
