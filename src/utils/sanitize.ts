/**
 * Recursively converts BigInt hex objects to string values.
 * API returns {hex: "0x..."} for BigInt fields which can't be JSON serialized.
 */
export function sanitizeBigInts(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  // Check for hex object pattern: {hex: "0x..."}
  if (typeof obj === 'object' && 'hex' in obj && typeof (obj as any).hex === 'string') {
    return (obj as any).hex;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeBigInts);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeBigInts(value);
    }
    return result;
  }

  return obj;
}
