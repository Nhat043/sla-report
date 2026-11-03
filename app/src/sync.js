export class SyncManager {
  constructor({ client, store, log = console.log }) { this.client = client; this.store = store; this.log = log; this.cursor = null; }
  apply(change) { if (change.type === "request.created" || change.type === "request.updated") this.store.putRequest(change.request); else if (change.type === "event.created") this.store.putEvent(change.request_id, change.event); else if (change.type === "staff.updated") this.store.putStaff(change.staff); }
  async initialSync() {
    const [sites, staff] = await Promise.all([this.client.sites(), this.client.staff()]); const holidays = await Promise.all(sites.data.map(site => this.client.holidays(site.id)));
    for (const member of staff.data) this.store.putStaff(member); sites.data.forEach((site, index) => this.store.putSite(site, holidays[index].data));
    let cursor; do { const page = await this.client.changes(cursor, 500); for (const change of page.data) this.apply(change); cursor = page.next_cursor; if (!page.has_more) break; } while (cursor);
    this.cursor = cursor; this.store.warm(); this.store.ready = true; this.log("initial sync complete; ready");
  }
}
