const ISO_WITH_TIMEZONE_RE = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

export function parseApiDateMs(value?: string | null): number | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalized = ISO_WITH_TIMEZONE_RE.test(trimmed) ? trimmed : `${trimmed}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isDateInPast(value?: string | null, nowMs = Date.now()): boolean {
  const parsed = parseApiDateMs(value);
  return parsed !== null && parsed <= nowMs;
}
