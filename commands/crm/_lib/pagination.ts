// Extract cursor from HubSpot paging response
export function extractCursor(paging?: {
  next?: { after?: string };
}): string | null {
  return paging?.next?.after ?? null;
}

// Build pagination params
export function paginationParams(
  limit: number,
  after?: string
): Record<string, string | undefined> {
  return {
    limit: String(limit),
    after: after || undefined,
  };
}
