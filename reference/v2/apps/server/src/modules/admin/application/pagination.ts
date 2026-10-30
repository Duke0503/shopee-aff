/** Shared page parsing for the admin list endpoints, matching the old limits. */
export interface Page {
  page: number;
  limit: number;
  offset: number;
}

function intOr(raw: string | undefined, fallback: number): number {
  return raw !== undefined && /^\d+$/.test(raw) ? Number.parseInt(raw, 10) : fallback;
}

export function parsePage(raw: { page?: string; limit?: string }, defaultLimit = 20): Page {
  const page = Math.max(1, intOr(raw.page, 1));
  const limit = Math.min(200, Math.max(1, intOr(raw.limit, defaultLimit)));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginationMeta(page: Page, total: number) {
  return {
    page: page.page,
    limit: page.limit,
    total,
    total_pages: page.limit > 0 ? Math.ceil(total / page.limit) : 1,
  };
}
