export class HelpdeskError extends Error {
  constructor(message, { status = null, path = "" } = {}) { super(message); this.name = "HelpdeskError"; this.status = status; this.path = path; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class HelpdeskClient {
  constructor({ baseUrl = process.env.HELPDESK_URL || "http://localhost:4010", token = process.env.HELPDESK_TOKEN || "", fetchImpl = fetch, timeoutMs = 15_000, retries = 4 } = {}) { this.baseUrl = baseUrl.replace(/\/+$/, ""); this.token = token; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.retries = retries; }
  async get(pathname, params = {}) {
    const url = new URL(this.baseUrl + pathname); for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
    for (let attempt = 0; attempt <= this.retries; attempt += 1) try {
      const response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.ok) return response.json(); const retryAfter = Number(response.headers.get("retry-after"));
      if ((response.status === 429 || response.status >= 500) && attempt < this.retries) { await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt); continue; }
      throw new HelpdeskError(`GET ${pathname} failed: ${response.status}`, { status: response.status, path: pathname });
    } catch (error) { if (error instanceof HelpdeskError || attempt === this.retries) throw error; await sleep(250 * 2 ** attempt); }
  }
  changes(cursor, limit = 500) { return this.get("/v1/changes", { cursor, limit }); }
  sites() { return this.get("/v1/sites"); }
  holidays(siteId) { return this.get(`/v1/sites/${siteId}/holidays`); }
  staff() { return this.get("/v1/staff"); }
}
