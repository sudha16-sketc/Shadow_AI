/**
 * Pagination helpers — every list endpoint must bounds-check client input
 * instead of forwarding `page` / `limit` straight into the database driver.
 */
export function clampPagination(query = {}, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const rawPage = Number.parseInt(query.page, 10);
  const rawLimit = Number.parseInt(query.limit, 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

/** Bounds a `days` window query parameter. Invalid input falls back to the default. */
export function clampDays(value, { defaultDays = 30, maxDays = 365 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultDays;
  return Math.min(Math.floor(parsed), maxDays);
}

/** Escapes user input before it is embedded in a MongoDB $regex pattern. */
export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
