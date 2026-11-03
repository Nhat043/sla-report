import { calculate } from "./sla.js";
import { localDate } from "./tz.js";

export class Store {
  constructor() { this.requests = new Map(); this.events = new Map(); this.sites = new Map(); this.staff = new Map(); this.holidays = new Map(); this.cache = new Map(); this.snapshots = new Map(); }
  putRequest(request) { this.requests.set(request.id, request); this.cache.delete(request.id); }
  putEvent(requestId, event) { if (!this.events.has(requestId)) this.events.set(requestId, new Map()); this.events.get(requestId).set(event.id, event); this.cache.delete(requestId); }
  putStaff(staff) { this.staff.set(staff.id, staff); }
  putSite(site, holidays = []) { this.sites.set(site.id, site); this.holidays.set(site.id, new Set(holidays.map(({ date }) => { const [day, month, year] = date.split("/"); return `${year}-${month}-${day}`; }))); }
  row(request) {
    const site = this.sites.get(request.site_id); if (!site) return null;
    if (!this.cache.has(request.id)) this.cache.set(request.id, calculate(request, [...(this.events.get(request.id)?.values() || [])], site, this.holidays.get(site.id) || new Set()));
    const sla = this.cache.get(request.id); const staff = sla.responder_id == null ? null : this.staff.get(sla.responder_id);
    return { id: request.id, site_id: request.site_id, responder_id: sla.responder_id, responder: staff?.name ?? null, response_business_minutes: sla.response_business_minutes, within_target: sla.within_target, completed_late: sla.completed_late };
  }
  report(from, to) { return [...this.requests.values()].filter(request => { const site = this.sites.get(request.site_id); const date = site && localDate(Date.parse(request.created_at), site.timezone); return site && date >= from && date <= to && request.status !== "canceled" && !request.deleted_at && !request.merged_into_id; }).map(request => this.row(request)).filter(Boolean); }
  warm() { for (const request of this.requests.values()) this.row(request); }
}
