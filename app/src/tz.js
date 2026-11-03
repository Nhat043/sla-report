const formatters = new Map();
function formatter(timezone) {
  if (!formatters.has(timezone)) formatters.set(timezone, new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }));
  return formatters.get(timezone);
}
export function partsAt(ms, timezone) { return Object.fromEntries(formatter(timezone).formatToParts(new Date(ms)).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)])); }
export function localDate(ms, timezone) { const p = partsAt(ms, timezone); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }
export function addDays(date, days) { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
export function weekday(date) { return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${date}T12:00:00Z`).getUTCDay()]; }
export function wallTime(date, clock, timezone) {
  const [hour, minute] = clock.split(":").map(Number); const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute); let instant = target;
  for (let step = 0; step < 4; step += 1) { const seen = partsAt(instant, timezone); instant += target - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second); }
  return instant;
}
export function deadlineTime(value, timezone) { const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})$/.exec(value || ""); return match ? wallTime(`${match[3]}-${match[2]}-${match[1]}`, match[4], timezone) : null; }
