/** YYYY-MM-DD in Kopi's configured time zone, offset by calendar days. */
export function localISODate(offsetDays = 0, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + offsetDays);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
