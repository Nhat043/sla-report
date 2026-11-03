import { businessSeconds } from "./business-time.js";
import { deadlineTime } from "./tz.js";
export function activeEvents(events = []) { const undone = new Set(events.filter(event => event.reverts_id != null).flatMap(event => [event.id, event.reverts_id])); return events.filter(event => !undone.has(event.id)); }
export function calculate(request, events, site, holidays) {
  const valid = activeEvents(events);
  const response = valid.filter(event => event.status === "processing" && event.actor_id != null).sort((a, b) => a.at - b.at)[0];
  const dueEvents = valid.filter(event => event.due_at).sort((a, b) => a.at - b.at);
  const completion = valid.filter(event => event.status === "complete").sort((a, b) => a.at - b.at).at(-1);
  const deadline = dueEvents.length ? deadlineTime(dueEvents.at(-1).due_at, site.timezone) : null;
  const completed_late = completion && deadline != null ? completion.at * 1000 > deadline : null;
  if (!response) return { responder_id: null, response_business_minutes: null, within_target: null, completed_late };
  const response_business_minutes = Math.floor(businessSeconds(Date.parse(request.created_at), response.at * 1000, site, holidays) / 60);
  const target = request.priority === "High" ? 60 : request.priority === "Medium" ? 240 : 480;
  return { responder_id: response.actor_id, response_business_minutes, within_target: response_business_minutes <= target, completed_late };
}
