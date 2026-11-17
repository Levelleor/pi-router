/**
 * Antigravity CLI sometimes reports subscription exhaustion as a *successful
 * assistant text message*, not an error. Its Pi bridge faithfully turns that
 * message into streamed text deltas. Match only the known, provider-authored
 * banner, not arbitrary text mentioning quotas.
 */
const QUOTA_PREFIX = "⚠ individual quota reached.";
const QUOTA_BANNER = /^⚠\s*individual quota reached\.\s*(?:please upgrade your subscription to increase your limits\.\s*)?(?:resets in\s+\d+h\d+m\d+s\.?\s*)?$/i;
const QUOTA_RESET = /\bresets in\s+(\d+)h(\d+)m(\d+)s\b/i;

function normalize(text: string): string {
  return text.replace(/\uFE0F/g, "").trimStart().replace(/\s+/g, " ").toLowerCase();
}

/** Until ruled out, delay committing only a potential initial quota banner. */
export function isPotentialAntigravityQuotaBanner(text: string): boolean {
  if (!text.trim()) return text.length <= 32;
  const normalized = normalize(text);
  return QUOTA_PREFIX.startsWith(normalized) || normalized.startsWith(QUOTA_PREFIX);
}

/** A completed banner, or a banner carrying a full native reset duration. */
export function isAntigravityQuotaBanner(text: string, complete = false): boolean {
  const normalized = normalize(text);
  return QUOTA_BANNER.test(normalized) &&
    (complete || QUOTA_RESET.test(normalized));
}

/** The CLI's "Resets in 153h38m14s" is an explicit quota-reset hint. */
export function antigravityQuotaResetSeconds(text: string): number | undefined {
  if (!isAntigravityQuotaBanner(text, true)) return undefined;
  const match = QUOTA_RESET.exec(normalize(text));
  if (!match) return undefined;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 30 * 24 * 3600 ? seconds : undefined;
}
