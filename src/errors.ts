/** `err.message`, plus `err.cause`'s if it has one — the specific reason
 * something was rejected (e.g. which field of which record), not just the
 * boundary's generic "the file/store contains an invalid pin". */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error ? `${message}: ${cause.message}` : message;
}
