import { createApp } from "./app.js";
import { HelpdeskClient } from "./helpdesk.js";
import { Store } from "./store.js";
import { SyncManager } from "./sync.js";

const port = Number(process.env.PORT || 8080);

const store = new Store();
const sync = new SyncManager({ client: new HelpdeskClient(), store, log: message => console.log(message) });
createApp({ store }).listen(port, "0.0.0.0", () => {
  console.log(`listening on http://0.0.0.0:${port}`);
  sync.start().catch(error => console.error("initial sync failed", error.message));
});
