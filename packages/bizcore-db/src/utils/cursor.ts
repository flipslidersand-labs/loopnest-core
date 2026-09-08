/**
 * Opaque cursor for keyset (cursor-based) pagination.
 * Encodes the last row's (created_at, id) pair so the next page can be fetched
 * with WHERE conditions instead of OFFSET, keeping query cost constant.
 */

export interface CursorPayload {
  createdAt: string; // ISO-8601
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed.createdAt === 'string' && typeof parsed.id === 'string') {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function makeCursor(row: { createdAt: Date | string; id: string }): string {
  return encodeCursor({
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    id: row.id,
  });
}
