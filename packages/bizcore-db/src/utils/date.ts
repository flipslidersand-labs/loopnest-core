/**
 * Formats a JS Date as a "YYYY-MM-DD" calendar date string using its
 * *local* date components, not UTC.
 *
 * node-postgres parses Postgres `DATE` columns into a JS Date set to local
 * midnight for that calendar day. `Date.prototype.toISOString()` always
 * renders in UTC, so on any server whose timezone is ahead of UTC (e.g.
 * JST, UTC+9) that midnight rolls back into the previous UTC day and the
 * date read back is one day earlier than what was stored.
 */
export function toDateOnlyStr(value: Date | string): string {
  if (typeof value === 'string') return value;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
