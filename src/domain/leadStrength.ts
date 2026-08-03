/**
 * Lead strength is the product's core semantic: every restaurant pin is exactly
 * one of these, and each renders in exactly one color. Keep this mapping total,
 * fixed, and the single source of truth for both.
 */

export const LEAD_STRENGTHS = ['strong', 'weak', 'failed'] as const;

export type LeadStrength = (typeof LEAD_STRENGTHS)[number];

/**
 * Strength -> pin color. The `satisfies Record<LeadStrength, string>` makes the
 * mapping EXHAUSTIVE at compile time: add a member to LeadStrength without a
 * color here and the build fails. A pin can never render with a default color.
 */
const STRENGTH_COLORS = {
  strong: '#2e9e4f', // green
  weak: '#e8a33d', // amber
  failed: '#d64545', // red
} satisfies Record<LeadStrength, string>;

export const STRENGTH_LABELS = {
  strong: 'Strong',
  weak: 'Weak',
  failed: 'Failed',
} satisfies Record<LeadStrength, string>;

export class UnknownLeadStrengthError extends Error {
  constructor(value: unknown) {
    super(`Unknown lead strength: ${JSON.stringify(value)}`);
    this.name = 'UnknownLeadStrengthError';
  }
}

/** Runtime type guard for values coming from untrusted sources (e.g. storage). */
export function isLeadStrength(value: unknown): value is LeadStrength {
  return (
    typeof value === 'string' &&
    (LEAD_STRENGTHS as readonly string[]).includes(value)
  );
}

/**
 * The pin color for a strength. Throws (never returns a default) if handed a
 * value that bypassed the type system — a wrong color silently misrepresents a
 * lead, so we fail loud instead.
 */
export function colorForStrength(strength: LeadStrength): string {
  const color: string | undefined = STRENGTH_COLORS[strength];
  if (color === undefined) {
    throw new UnknownLeadStrengthError(strength);
  }
  return color;
}
