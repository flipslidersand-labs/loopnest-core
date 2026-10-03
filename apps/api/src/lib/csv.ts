/**
 * Encode a row of values as a CSV line, quoting every field and escaping
 * embedded double quotes per RFC 4180 (`"` -> `""`).
 */
export function toCsvRow(fields: unknown[]): string {
  return fields.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
}
