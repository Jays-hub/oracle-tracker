import { describe, it, expect } from 'vitest';
import {
  LEAD_STRENGTHS,
  colorForStrength,
  isLeadStrength,
  UnknownLeadStrengthError,
} from './leadStrength';

describe('colorForStrength', () => {
  // Correctness: the exact, fixed mapping the whole product hangs on.
  it('maps each strength to its fixed color', () => {
    expect(colorForStrength('strong')).toBe('#2e9e4f');
    expect(colorForStrength('weak')).toBe('#e8a33d');
    expect(colorForStrength('failed')).toBe('#d64545');
  });

  // Totality + distinctness: every declared strength has a valid, unique color.
  it('is total and injective over all lead strengths', () => {
    const colors = LEAD_STRENGTHS.map(colorForStrength);
    expect(colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    expect(new Set(colors).size).toBe(LEAD_STRENGTHS.length);
  });

  // Fail-loud edge case: a value that bypassed the type system throws — never a
  // silent default color that would misrepresent the lead.
  it('throws UnknownLeadStrengthError on an unmapped value', () => {
    // @ts-expect-error deliberately invalid input to exercise the runtime guard
    expect(() => colorForStrength('lukewarm')).toThrow(UnknownLeadStrengthError);
  });
});

describe('isLeadStrength', () => {
  it('accepts the three valid strengths and rejects everything else', () => {
    expect(LEAD_STRENGTHS.every(isLeadStrength)).toBe(true);
    for (const bad of ['', 'STRONG', 'lukewarm', 0, null, undefined, {}]) {
      expect(isLeadStrength(bad)).toBe(false);
    }
  });
});
