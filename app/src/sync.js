export class SyncManager {
  constructor({ client, store, log = console.log, pollMs = 15_000, setIntervalImpl = setInterval }) { this.client = client; this.store = store; this.log = log; this.pollMs = pollMs; this.setIntervalImpl = setIntervalImpl; this.cursor = null; this.polling = false; this.seenSeq = new Set(); }
  apply(change) {
    if (change.seq != null) { if (this.seenSeq.has(change.seq)) return; this.seenSeq.add(change.seq); }
    if (change.type === "request.created" || change.type === "request.updated") this.store.putRequest(change.request); else if (change.type === "event.created") this.store.putEvent(change.request_id, change.event); else if (change.type === "staff.updated") this.store.putStaff(change.staff);
  }
  async initialSync() {
    const [sites, staff] = await Promise.all([this.client.sites(), this.client.staff()]); const holidays = await Promise.all(sites.data.map(site => this.client.holidays(site.id)));
    for (const member of staff.data) this.store.putStaff(member); sites.data.forEach((site, index) => this.store.putSite(site, holidays[index].data));
    let cursor; do { const page = await this.client.changes(cursor, 500); for (const change of page.data) this.apply(change); cursor = page.next_cursor; if (!page.has_more) break; } while (cursor);
    this.cursor = cursor; this.store.warm(); this.store.ready = true; this.log("initial sync complete; ready");
  }
  async poll() {
    if (this.polling || !this.store.ready) return;
    this.polling = true;
    try {
      let page;
      try { page = await this.client.changes(this.cursor, 500); }
      catch (error) {
        if (error.status !== 410) throw error;
        this.log("change cursor expired; replaying feed"); this.cursor = null; this.seenSeq.clear(); await this.initialSync(); return;
      }
      for (const change of page.data) this.apply(change);
      this.cursor = page.next_cursor;
    } catch (error) { this.log(`change poll failed: ${error.message}`); }
    finally { this.polling = false; }
  }
  async start() { await this.initialSync(); this.setIntervalImpl(() => this.poll(), this.pollMs); }
}
