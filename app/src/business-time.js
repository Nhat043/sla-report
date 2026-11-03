import { addDays, localDate, wallTime, weekday } from "./tz.js";
export function businessSeconds(start, end, site, holidays = new Set()) {
  if (end <= start) return 0;
  let seconds = 0;
  for (let date = localDate(start, site.timezone), last = localDate(end, site.timezone); date <= last; date = addDays(date, 1)) {
    const hours = site.business_hours?.[weekday(date)];
    if (!hours || holidays.has(date)) continue;
    seconds += Math.max(0, Math.min(end, wallTime(date, hours.close, site.timezone)) - Math.max(start, wallTime(date, hours.open, site.timezone)));
  }
  return Math.floor(seconds / 1000);
}
