import { calculate } from "./sla.js";
import { localDate } from "./tz.js";

// In-memory copy of the helpdesk data plus a per-request SLA cache.
export class Store {
  constructor() {
    this.requests = new Map();   // id -> request
    this.events = new Map();     // requestId -> Map(eventId -> event)
    this.sites = new Map();      // id -> site
    this.staff = new Map();      // id -> staff
    this.holidays = new Map();   // siteId -> Set("YYYY-MM-DD")
    this.cache = new Map();      // requestId -> computed SLA facts
    this.snapshots = new Map();  // cursor -> frozen browse page state
  }

  putRequest(request) {
    this.requests.set(request.id, request);
    this.cache.delete(request.id); // request changed: recompute on next read
  }

  putEvent(requestId, event) {
    if (!this.events.has(requestId)) this.events.set(requestId, new Map());
    this.events.get(requestId).set(event.id, event);
    this.cache.delete(requestId); // events changed: recompute on next read
  }

  putStaff(staff) {
    this.staff.set(staff.id, staff);
  }

  putSite(site, holidays = []) {
    this.sites.set(site.id, site);
    // Holiday dates arrive as DD/MM/YYYY; store them as YYYY-MM-DD for lookup.
    const dates = holidays.map(({ date }) => {
      const [day, month, year] = date.split("/");
      return `${year}-${month}-${day}`;
    });
    this.holidays.set(site.id, new Set(dates));
  }

  // Build one report row for a request, using the cached SLA facts and the
  // responder's current name from /v1/staff.
  row(request) {
    const site = this.sites.get(request.site_id);
    if (!site) return null;

    if (!this.cache.has(request.id)) {
      const events = [...(this.events.get(request.id)?.values() || [])];
      const holidays = this.holidays.get(site.id) || new Set();
      this.cache.set(request.id, calculate(request, events, site, holidays));
    }
    const sla = this.cache.get(request.id);
    const staff = sla.responder_id == null ? null : this.staff.get(sla.responder_id);

    return {
      id: request.id,
      site_id: request.site_id,
      responder_id: sla.responder_id,
      responder: staff?.name ?? null,
      response_business_minutes: sla.response_business_minutes,
      within_target: sla.within_target,
      completed_late: sla.completed_late,
    };
  }

  // All eligible rows in [from, to] (rule 1): site-local created date in range,
  // excluding canceled, deleted and merged requests.
  report(from, to) {
    const rows = [];
    for (const request of this.requests.values()) {
      const site = this.sites.get(request.site_id);
      if (!site) continue;
      const date = localDate(Date.parse(request.created_at), site.timezone);
      if (date < from || date > to) continue;
      if (request.status === "canceled" || request.deleted_at || request.merged_into_id) continue;
      const row = this.row(request);
      if (row) rows.push(row);
    }
    return rows;
  }

  // Pre-compute every request's SLA facts so the first report is fast.
  warm() {
    for (const request of this.requests.values()) this.row(request);
  }
}
