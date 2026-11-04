# DECISIONS

Write in English. Short bullet points are fine. Reviewers read this file alongside your code.

## What I assumed

- The change feed is the authoritative source for historical requests and events because it is documented as containing every change since the start.
- Report eligibility is calculated using the request's site-local creation date, not its UTC date.
- Deadlines are site-local wall-clock values. The timezone conversion uses the site's IANA timezone, including Sydney DST transitions.
- The deadline is the `due_at` on the latest valid event by event timestamp; the request's current `due_on` is not used.
- A reverting event and the event it references are both excluded before calculating response, completion, and deadline facts.
- Unknown query parameters are ignored. Invalid required parameters and invalid cursors return `400`.
- An in-memory cache is acceptable for this time-boxed, single-process service. A restart intentionally performs a fresh initial sync.

## What I found in the API or data

- Feed items may be delivered more than once. Request and event maps are keyed by ID, and feed sequence numbers are deduplicated during live polling.
- Staff names are mutable. Report rows resolve the responder name from the current staff record rather than the historical name attached to an event.
- A feed cursor can expire. The poller detects a `410`, clears cursor state, and safely replays the feed.
- Sites differ in more than timezone: Jakarta (site 13) is open Saturday 08:00–12:00, while Singapore and Sydney are closed at weekends. Hours are read per weekday from `/v1/sites`, so nothing is hardcoded to "weekend = closed"; `null` days and holidays are treated as closed.
- Two different staff members can share the same name (ids 368 and 371 are both "Marcus Lee"). Responders are therefore grouped by `id`, never by name, matching the contract's one-row-per-responder requirement.
- The helpdesk clock can run ahead of the local machine. SLA results use only event and request timestamps, never "now"; "now" is used solely to choose the initial report window, so a clock skew does not change any computed metric.

## How I used AI

- I used Claude Code (Opus) as an implementation and review assistant: to scaffold the Node modules, review correctness against the rules, refactor for readability, write and expand the test suite, add the CSV export requested by the client, and verify timings and readiness behaviour against the practice API.
- I reviewed and edited all generated code, used the test suite to catch a syntax issue in a live-sync test, and kept the final design consistent with the provided rules.
- No generated API data or secrets are included in the repository.

## Level status

- All four levels (report, fast, live, browse) are implemented and pass the local test suite (19 tests).
- Measured on the practice API via `docker compose up --build`: `/ready` reached 200 in about 54 s (reading the full change feed), the October report returned 1,925 requests in about 0.12 s, and the 1 May–31 Oct report in about 0.33 s — against the 8-minute, 5 s and 10 s limits. While still syncing, `/health` is 200 and `/ready`, `/api/sla-report` and `/api/requests` all return 503.
- Not independently load-tested against grader-scale data; these timings are from the practice dataset only.

## Client requests

- On 1 Nov the client asked for a CSV download for the finance team to pull the
  monthly request list into Excel. Added `GET /api/requests.csv` returning the
  full result set (no paging) with the same filters and sort as `/api/requests`,
  plus a "Download CSV" button that reuses the current UI filters. The JSON and
  CSV endpoints share one filter/sort implementation so they cannot drift.

## Trade-offs and what I would do next

- The service deliberately uses one in-memory process rather than a database. A production version would persist requests, events, feed cursor, and report snapshots.
- The UI is intentionally plain; the contract APIs and correctness of the SLA calculation were prioritized over visual polish.
- The client retries network and server errors and follows `Retry-After` for rate limits. Initial data is cached and warmed; the change feed is polled every 15 seconds, comfortably inside the one-minute live-update requirement.
- With more time I would add end-to-end contract tests against a mock Helpdesk server, metrics for sync lag/rate limits, snapshot expiry cleanup, structured logs, and a stronger DST test matrix.
- Verification: `npm test` and `docker compose run --rm app test` both pass all 19 tests, covering health, the SLA rules, report and query validation, filters, sorting, rule-1 exclusions, initial sync, live-feed deduplication, cursor pagination and CSV export. Browse pagination was checked across pages with no duplicate IDs, and an inverted date range returned `400`. Report timings are in the Level status section above.
