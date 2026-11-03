import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateRange(query) { const { from, to } = query; return DATE.test(from || "") && DATE.test(to || "") && from <= to ? { from, to } : null; }

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
    // TODO (level 4): filters, sorting and cursor pagination, see docs/contract.md.
    res.status(501).json({ error: "not implemented" });
  });

  app.get("/api/sla-report", (req, res) => {
    const range = dateRange(req.query); if (!range) return res.status(400).json({ error: "invalid date range" });
    const requests = store.report(range.from, range.to); const groups = new Map();
    for (const row of requests) if (row.responder_id != null) { const group = groups.get(row.responder_id) || { id: row.responder_id, name: row.responder, requests: 0, within_target: 0, completed_late: 0 }; group.requests += 1; if (row.within_target) group.within_target += 1; if (row.completed_late) group.completed_late += 1; groups.set(row.responder_id, group); }
    res.json({ ...range, requests, responders: [...groups.values()] });
  });

  return app;
}
