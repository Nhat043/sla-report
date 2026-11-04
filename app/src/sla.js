import { businessSeconds } from "./business-time.js";
import { deadlineTime } from "./tz.js";

// Rule 2: an event with reverts_id undoes the event it points at. Drop both
// the reverting event and the one it reverts before applying any other rule.
export function activeEvents(events = []) {
  const undone = new Set();
  for (const event of events) {
    if (event.reverts_id != null) {
      undone.add(event.id);
      undone.add(event.reverts_id);
    }
  }
  return events.filter(event => !undone.has(event.id));
}

// Compute the SLA facts (rules 3-7) for one request.
export function calculate(request, events, site, holidays) {
  const valid = activeEvents(events);

  // Rule 3: first response = earliest processing event with a human actor.
  const response = valid
    .filter(event => event.status === "processing" && event.actor_id != null)
    .sort((a, b) => a.at - b.at)[0];

  // Rule 6: deadline = due_at of the latest event that sets one; completed late
  // if the last complete event is strictly after it.
  const dueEvents = valid.filter(event => event.due_at).sort((a, b) => a.at - b.at);
  const deadline = dueEvents.length ? deadlineTime(dueEvents.at(-1).due_at, site.timezone) : null;
  const completion = valid.filter(event => event.status === "complete").sort((a, b) => a.at - b.at).at(-1);
  const completed_late = completion && deadline != null ? completion.at * 1000 > deadline : null;

  // Rule 7: no first response -> response fields are null.
  if (!response) {
    return { responder_id: null, response_business_minutes: null, within_target: null, completed_late };
  }

  // Rule 4: business-hours time from created_at to the first response.
  const response_business_minutes = Math.floor(
    businessSeconds(Date.parse(request.created_at), response.at * 1000, site, holidays) / 60);

  // Rule 5: within target depends on priority (null priority uses the Low target).
  const target = request.priority === "High" ? 60 : request.priority === "Medium" ? 240 : 480;

  return {
    responder_id: response.actor_id,
    response_business_minutes,
    within_target: response_business_minutes <= target,
    completed_late,
  };
}
