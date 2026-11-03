# DECISIONS

Write in English. Short bullet points are fine. Reviewers read this file alongside your code.

## What I assumed

- The change feed is the authoritative source for historical requests and events because it is documented as containing every change since the start.
- Report eligibility is calculated using the request's site-local creation date, not its UTC date.
- Deadlines are site-local wall-clock values. The timezone conversion uses the site's IANA timezone, including Sydney DST transitions.
- An in-memory cache is acceptable for this time-boxed, single-process service. A restart intentionally performs a fresh initial sync.

## What I found in the API or data

- Feed items may be delivered more than once. Request and event maps are keyed by ID, and feed sequence numbers are deduplicated during live polling.
- Staff names are mutable. Report rows resolve the responder name from the current staff record rather than the historical name attached to an event.
- A feed cursor can expire. The poller detects a `410`, clears cursor state, and safely replays the feed.

## How I used AI

- I used Codex as an implementation and review assistant: to scaffold small Node modules, propose tests, and check the documented API contract.
- I reviewed and edited all generated code, used the test suite to catch a syntax issue in a live-sync test, and kept the final design consistent with the provided rules.
- No generated API data or secrets are included in the repository.

## Trade-offs and what I would do next

- The service deliberately uses one in-memory process rather than a database. A production version would persist requests, events, feed cursor, and report snapshots.
- The UI is intentionally plain; the contract APIs and correctness of the SLA calculation were prioritized over visual polish.
- The client retries network and server errors and follows `Retry-After` for rate limits. Initial data is cached and warmed; the change feed is polled every 15 seconds, comfortably inside the one-minute live-update requirement.
- With more time I would add end-to-end contract tests against a mock Helpdesk server, metrics for sync lag/rate limits, snapshot expiry cleanup, structured logs, and a stronger DST test matrix.
- Verification performed locally: `npm test` passes with nine tests covering health, SLA rules, report validation, initial sync, live-feed deduplication, and cursor pagination. Docker Desktop was unavailable on the development machine, so the Docker Compose workflow should be rechecked before submission.
