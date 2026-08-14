import { describe, expect, it } from 'vitest';
// The stylesheet is the artifact under test, so it has to be read as text
// rather than described by a copy of itself — the same reason mapFit.test.ts
// reads it for the map pane's floor.
import css from './index.css?raw';
import { LEAD_STRENGTHS, colorForStrength } from './domain/leadStrength';

/* ---------------------------------------------------------------------------
 * A deliberately small CSS reader.
 *
 * Not a CSS parser: index.css has no at-rules and no nesting (both asserted
 * below, so this stays true rather than being assumed), which makes
 * "comment-stripped text split on braces" exact for this file. A real parser
 * would be a dependency and a lot of machinery for a sheet this shape.
 * ------------------------------------------------------------------------ */

const SOURCE_WITHOUT_COMMENTS = css.replace(/\/\*[\s\S]*?\*\//g, '');

interface Rule {
  /** The full selector text, e.g. `.a, .b` or `.btn:disabled`. */
  selector: string;
  /** Each comma-separated selector, trimmed. */
  selectors: string[];
  /** The declaration block, without braces. */
  body: string;
  /** Position in the file — source order decides same-specificity winners. */
  index: number;
}

function readRules(): Rule[] {
  const rules: Rule[] = [];
  for (const match of SOURCE_WITHOUT_COMMENTS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    rules.push({
      selector,
      selectors: selector.split(',').map((s) => s.trim()),
      body: match[2],
      index: rules.length,
    });
  }
  return rules;
}

const RULES = readRules();

interface Declaration {
  property: string;
  value: string;
  selector: string;
}

function readDeclarations(rule: Rule): Declaration[] {
  return rule.body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
    .map((d) => {
      const colon = d.indexOf(':');
      return {
        property: d.slice(0, colon).trim(),
        value: d.slice(colon + 1).trim().replace(/\s+/g, ' '),
        selector: rule.selector,
      };
    });
}

const DECLARATIONS = RULES.flatMap(readDeclarations);

/** The custom properties declared on `:root`, resolved as literal values. */
const TOKENS: Record<string, string> = Object.fromEntries(
  RULES.filter((r) => r.selector === ':root')
    .flatMap(readDeclarations)
    .filter((d) => d.property.startsWith('--'))
    .map((d) => [d.property, d.value]),
);

/** Strip pseudo-classes/elements: `.btn:focus-visible` -> `.btn`. */
function withoutPseudos(selector: string): string {
  return selector.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');
}

function classesIn(selector: string): string[] {
  return selector.match(/\.[A-Za-z0-9_-]+/g) ?? [];
}

/* ---------------------------------------------------------------------------
 * Color math (WCAG 2.1 relative luminance / contrast ratio).
 * ------------------------------------------------------------------------ */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) throw new Error(`not a 6-digit hex color: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Every color literal in `source`, normalised to lowercase `#rrggbb`.
 *
 * CSS lets the same color be written several ways, so any check that compares
 * against one spelling is checking the spelling rather than the color. Covers
 * `#rgb`, `#rrggbb` and `rgb()/rgba()` with either comma or space separators —
 * the notations that can actually appear here. Named colors (`red`) and
 * `hsl()` are NOT covered; the sheet uses neither, and the single-class /
 * token rules keep new raw colors out of everything but `:root`.
 */
function colorLiteralsIn(source: string): string[] {
  const found: string[] = [];
  const hex = (n: number) => n.toString(16).padStart(2, '0');

  for (const match of source.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    const digits = match[1].toLowerCase();
    found.push(
      digits.length === 3 ? `#${[...digits].map((d) => d + d).join('')}` : `#${digits}`,
    );
  }
  for (const match of source.matchAll(/rgba?\(([^)]*)\)/gi)) {
    const parts = match[1].split(/[\s,/]+/).filter((p) => p.length > 0);
    if (parts.length < 3) continue;
    const channels = parts.slice(0, 3).map((p) => Number.parseFloat(p));
    if (channels.some((c) => Number.isNaN(c))) continue;
    found.push(`#${channels.map((c) => hex(Math.round(c))).join('')}`);
  }
  return found;
}

/** A token name -> its hex, failing loudly rather than defaulting. */
function color(token: string): string {
  const value = TOKENS[token];
  if (value === undefined) throw new Error(`no ${token} on :root`);
  return value;
}

function ratio(fgToken: string, bgToken: string): number {
  return contrastRatio(color(fgToken), color(bgToken));
}

describe('the contrast helper itself', () => {
  // Every contrast assertion below is only worth as much as this function, and
  // a broken one fails open (everything looks high-contrast). These are the
  // three values the WCAG formula is pinned to by definition.
  it('matches the WCAG reference values at both extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('is symmetric — order of the pair cannot change the answer', () => {
    expect(contrastRatio('#20566b', '#faf9f7')).toBeCloseTo(
      contrastRatio('#faf9f7', '#20566b'),
      10,
    );
  });

  it('rejects a value it cannot read instead of scoring it', () => {
    expect(() => contrastRatio('rebeccapurple', '#ffffff')).toThrow(/hex color/);
    expect(() => contrastRatio('#fff', '#ffffff')).toThrow(/hex color/);
  });
});

describe('the type scale', () => {
  // Derived from :root rather than listed, so a step added without being used
  // still has to satisfy both properties below (and the unused-token check).
  const STEPS = Object.keys(TOKENS).filter((t) => t.startsWith('--text-'));

  it('lands every step on a whole pixel at a 16px root', () => {
    // Hand-computed: 0.6875 x 16 = 11, 0.75 x 16 = 12, 0.8125 x 16 = 13,
    // 0.875 x 16 = 14, 1 x 16 = 16, 1.375 x 16 = 22.
    const pixels = STEPS.map((step) => {
      const rem = Number.parseFloat(color(step).replace('rem', ''));
      return rem * 16;
    });
    expect(pixels).toEqual([11, 12, 13, 14, 16, 22]);
  });

  it('is strictly increasing, so a "larger" step is never smaller', () => {
    const rems = STEPS.map((step) => Number.parseFloat(color(step)));
    for (let i = 1; i < rems.length; i += 1) {
      expect(rems[i]).toBeGreaterThan(rems[i - 1]);
    }
  });
});

describe('the spacing scale', () => {
  it('names every step after its own size on the 4px grid', () => {
    // `--space-N` is N x 4px. That invariant is the whole reason the names
    // are readable at a call site; a token that quietly stopped matching its
    // name would make every "consistent spacing" claim unverifiable.
    const steps = Object.keys(TOKENS).filter((t) => t.startsWith('--space-'));
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const n = Number(step.replace('--space-', ''));
      expect(color(step)).toBe(`${n * 4}px`);
    }
  });

  it('defines the radius scale it claims to have', () => {
    expect(color('--radius-sm')).toBe('6px');
    expect(color('--radius-md')).toBe('8px');
  });
});

describe('color contrast meets WCAG AA', () => {
  // Text: 1.4.3 Contrast (Minimum) — 4.5:1 for anything under 18.66px bold /
  // 24px regular, which is every piece of text in this app.
  const TEXT_PAIRS: [string, string][] = [
    ['--ink', '--canvas'],
    ['--ink', '--paper'],
    ['--ink', '--surface-sunken'],
    ['--ink', '--accent-tint'],
    ['--ink-body', '--canvas'],
    ['--ink-body', '--paper'],
    ['--ink-body', '--surface-hover'],
    ['--ink-body', '--accent-tint'],
    ['--ink-muted', '--canvas'],
    ['--ink-muted', '--paper'],
    ['--ink-muted', '--surface-sunken'],
    ['--ink-muted', '--surface-hover'],
    ['--ink-muted', '--accent-tint'],
    ['--accent', '--canvas'],
    ['--accent', '--paper'],
    ['--accent', '--surface-sunken'],
    // Filled buttons: the label is --paper on the fill, in both rest and hover.
    ['--paper', '--ink'],
    ['--paper', '--ink-body'],
    ['--paper', '--danger'],
    ['--paper', '--danger-ink'],
    // The outlined destructive button, at rest and hovered.
    ['--danger', '--paper'],
    ['--danger', '--danger-tint'],
    ['--danger-ink', '--danger-tint'],
    ['--warn-ink', '--canvas'],
    ['--warn-ink', '--paper'],
  ];

  it.each(TEXT_PAIRS)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // Non-text: 1.4.11 — 3:1 for the visual boundary that identifies a control,
  // and for a focus indicator against what surrounds it.
  const BOUNDARY_PAIRS: [string, string][] = [
    ['--line-control', '--paper'],
    ['--line-control', '--canvas'],
    ['--accent', '--paper'],
    ['--accent', '--canvas'],
    ['--accent', '--accent-tint'],
    ['--accent', '--surface-hover'],
  ];

  it.each(BOUNDARY_PAIRS)('%s against %s is at least 3:1', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  // WCAG exempts inactive controls from 1.4.3, so this pair could legitimately
  // sit at 3:1 — it is held to the full 4.5 anyway. Both earlier attempts
  // failed that bar (white on #b9c3d6 at 1.8:1 before the redesign, then a
  // dedicated disabled grey at 3.95:1, which only the in-browser sweep caught
  // because no token pair in the list above described it).
  it('holds a disabled control to full AA rather than taking the exemption', () => {
    expect(ratio('--ink-muted', '--disabled-surface')).toBeGreaterThanOrEqual(4.5);
  });

  // The token comment says a disabled control is signalled by "the flat fill,
  // the missing border and the not-allowed cursor". `.btn:disabled` cleared its
  // border; `.field__control:disabled` did not, leaving a --line-control edge on
  // --disabled-surface at 2.88:1 — under this sheet's own 3:1 boundary bar, and
  // under a rule it had written down for itself (docs/reviews/unit 8.md F3).
  // Asserted rather than trusted, because no pair in the list above describes a
  // border that is only present in one state.
  it.each(['.btn:disabled', '.field__control:disabled'])(
    '%s drops its border rather than leaving one at 2.88:1',
    (selector) => {
      const rule = RULES.find((r) => r.selectors.includes(selector));
      expect(rule, `no ${selector} rule`).toBeDefined();
      expect(rule!.body).toMatch(/border-color:\s*transparent/);
      // The bar it would fail if the border were left painted.
      expect(ratio('--line-control', '--disabled-surface')).toBeLessThan(3);
    },
  );

  // The hover and selected tints are both near-white; on their own they are a
  // ~1.02:1 difference, which is why a selected row also carries an accent
  // rule. Guarding the tints alone would have passed a design that relies on
  // them to distinguish the two states.
  it('does not rely on the hover/selected tints alone to separate the states', () => {
    const tintOnly = contrastRatio(color('--surface-hover'), color('--accent-tint'));
    expect(tintOnly).toBeLessThan(1.5);
    const selectedRow = RULES.find((r) => r.selector === '.pin-list__row--selected');
    expect(selectedRow?.body).toMatch(/box-shadow:[^;]*var\(--accent\)/);
  });
});

describe('the strength palette stays out of the stylesheet', () => {
  // CLAUDE.md's DONE-WHEN pins strong=green / weak=amber / failed=red. Those
  // three live in leadStrength.ts and reach the DOM only as an inline style
  // from colorForStrength — so a stylesheet edit cannot restyle, transpose or
  // shadow them. Read from the domain module rather than retyped, so the check
  // tracks the source of truth instead of a copy of it.
  it.each(LEAD_STRENGTHS)('never paints the %s color in CSS, in any notation', (strength) => {
    // Every color literal in the sheet, normalised to #rrggbb before comparing.
    // A hex-substring grep bans a *spelling*, not a color: the review planted
    // `background: rgb(214, 69, 69)` — the failed-lead red exactly — and the
    // old check passed it (docs/reviews/unit 8.md F2).
    //
    // Comment-stripped, deliberately: the comment on --danger cites the pin red
    // it is NOT allowed to be, and naming the constraint is the opposite of
    // violating it. Only a declaration can actually paint something.
    const target = colorForStrength(strength).toLowerCase();
    const offenders = colorLiteralsIn(SOURCE_WITHOUT_COMMENTS).filter((c) => c === target);
    expect(offenders).toEqual([]);
  });

  it('never uses !important, which is the one thing that could beat the inline color', () => {
    // A class rule loses to an inline style — except against `!important`.
    // Banning it outright keeps "the pin's color comes from the domain" true
    // by construction, and keeps every other cascade question decidable.
    expect(SOURCE_WITHOUT_COMMENTS).not.toMatch(/!\s*important/);
  });

  it('lets any swatch or marker class carry shape but never a fill', () => {
    // Matched by NAME, not by a hardcoded list. The review planted a brand-new
    // `.legend__swatch { background-image: … }` and the old four-name loop never
    // looked at it (docs/reviews/unit 8.md F2) — `background-image` is the
    // specific hazard, since it paints OVER the inline `background-color` that
    // carries the strength color, no `!important` required.
    const fillProperty = /^background(-color|-image|-blend-mode)?$/;
    const painted = RULES.filter((r) =>
      r.selectors.some((s) => /swatch|marker/i.test(s)),
    );

    // Guards the guard: if these classes are ever renamed out of the pattern,
    // this test must fail rather than quietly police an empty set.
    expect(painted.length).toBeGreaterThanOrEqual(4);

    const offenders = painted.flatMap((rule) =>
      readDeclarations(rule)
        .filter((d) => fillProperty.test(d.property))
        .map((d) => `${rule.selector} { ${d.property}: ${d.value} }`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('the cascade is decidable by construction', () => {
  /**
   * Every selector is exactly one class, plus pseudo-classes.
   *
   * This is the guard the roadmap asks for by name. Unit 3B shipped
   * `.import-export button` (specificity 0,1,1) alongside a plain
   * `.import-export__cancel` (0,1,0); the modifier lost silently and two
   * buttons rendered the same blue regardless of source order
   * (docs/reviews/Unit 3 Section B - export-import JSON.md). Patching each
   * instance with `button.` only matched the trap — removing every
   * class+element selector from the sheet removes the trap itself, and then
   * source order is the only tiebreak left (checked next).
   */
  const ALLOWED_SELECTORS = new Set([
    // Base/reset rules, which have to name elements and the mount point.
    '*',
    ':root',
    'html',
    'body',
    '#root',
    // The one descendant selector: it targets an element Leaflet owns and
    // renders itself, so there is no class of ours to hang it on.
    '.map-pane--armed .leaflet-container',
  ]);

  it.each(RULES.map((r) => r.selector))('%s is a single class', (selector) => {
    for (const one of selector.split(',').map((s) => s.trim())) {
      if (ALLOWED_SELECTORS.has(one)) continue;
      expect(withoutPseudos(one)).toMatch(/^\.[A-Za-z0-9_-]+$/);
    }
  });

  it('declares a modifier only after the base class it must beat', () => {
    // With every selector at the same specificity, `.btn--danger` wins over
    // `.btn` for exactly one reason: it comes later. Nothing about the file
    // enforces that on its own.
    const firstIndexOf = new Map<string, number>();
    for (const rule of RULES) {
      for (const selector of rule.selectors) {
        const bare = withoutPseudos(selector).trim();
        if (!firstIndexOf.has(bare)) firstIndexOf.set(bare, rule.index);
      }
    }

    for (const rule of RULES) {
      for (const className of rule.selectors.flatMap(classesIn)) {
        const separator = className.lastIndexOf('--');
        if (separator <= 0) continue;
        const base = className.slice(0, separator);
        const baseIndex = firstIndexOf.get(base);
        if (baseIndex === undefined) continue; // a modifier with no base rule
        expect(
          baseIndex,
          `${className} is declared before its base ${base}`,
        ).toBeLessThan(rule.index);
      }
    }
  });

  /**
   * A state selector is a class PLUS a pseudo-class — `.pin-list__row:hover` is
   * (0,2,0) — so it outranks a plain modifier like `.pin-list__row--selected`
   * (0,1,0) whatever the source order. Same silent-override shape as the Unit 3B
   * trap, one specificity column over, and the single-class rule above does not
   * catch it: both selectors are single classes.
   *
   * This found a live defect during the in-browser check for this unit —
   * hovering the row of the pin open in the editor dropped its selected tint
   * back to the ordinary hover tint.
   *
   * Some of these overrides are the point rather than a bug: a disabled button
   * has to look disabled whichever variant it is. Those are listed, so that
   * "the state wins here" is a decision on the record instead of an accident
   * nobody noticed.
   */
  it('never lets a state selector silently outrank a modifier', () => {
    const INTENDED: string[] = [
      // A disabled control reads as disabled before it reads as primary,
      // secondary or destructive — the variant's fill/border/label all yield.
      '.btn:disabled beats .btn--* on background',
      '.btn:disabled beats .btn--* on border-color',
      '.btn:disabled beats .btn--* on color',
    ];

    const propertiesOf = (predicate: (selector: string) => boolean): Map<string, Set<string>> => {
      const found = new Map<string, Set<string>>();
      for (const rule of RULES) {
        for (const selector of rule.selectors) {
          if (!predicate(selector)) continue;
          const base = withoutPseudos(selector).trim();
          const properties = found.get(base) ?? new Set<string>();
          for (const { property } of readDeclarations(rule)) properties.add(property);
          found.set(base, properties);
        }
      }
      return found;
    };

    const stateProperties = propertiesOf((s) => /^\.[A-Za-z0-9_-]+:[a-z-]+$/.test(s));
    const modifierProperties = propertiesOf((s) => /^\.[A-Za-z0-9_-]+$/.test(s));
    const declared = new Set(RULES.flatMap((r) => r.selectors));

    const unhandled: string[] = [];
    for (const [modifier, properties] of modifierProperties) {
      const separator = modifier.lastIndexOf('--');
      if (separator <= 0) continue;
      const base = modifier.slice(0, separator);
      for (const rule of RULES) {
        for (const selector of rule.selectors) {
          if (withoutPseudos(selector).trim() !== base) continue;
          const pseudo = selector.slice(base.length);
          if (pseudo === '') continue;
          const stateSets = stateProperties.get(base) ?? new Set<string>();
          for (const property of properties) {
            if (!stateSets.has(property)) continue;
            if (!readDeclarations(rule).some((d) => d.property === property)) continue;
            // Restated on the modifier's own state selector? Then it wins back.
            if (declared.has(`${modifier}${pseudo}`)) continue;
            const note = `${base}${pseudo} beats ${base}--* on ${property}`;
            if (INTENDED.includes(note)) continue;
            unhandled.push(`${base}${pseudo} silently beats ${modifier} on ${property}`);
          }
        }
      }
    }

    expect(unhandled).toEqual([]);
  });

  /**
   * A shared primitive may size itself, but it may not place itself.
   *
   * This is the generalised form of the one defect in this unit a browser found
   * and 154 green tests did not (docs/reviews/unit 8.md F1). `.link-button` was
   * extracted from a column container carrying `align-self: flex-start`, which
   * there meant "don't stretch"; reused in a centred row it meant "sit at the
   * top", and it silently beat the container's `align-items: center` because
   * self-alignment always wins. Nothing in a stylesheet-as-text check can see
   * the resulting 8px offset — but it CAN see the shape that causes it.
   *
   * Placement belongs to the container, or to a modifier the caller opts into
   * (`.link-button--start`). Sizing (`flex: 0 0 auto`) is fine: it says how to
   * behave if placed in a flex row, not where to go.
   */
  it('lets a shared primitive size itself but never place itself', () => {
    const PRIMITIVES = [
      '.btn',
      '.btn-row',
      '.link-button',
      '.field',
      '.field__label',
      '.field__control',
      '.overline',
      '.swatch',
      '.panel',
      '.panel__text',
      '.stack',
    ];
    const PLACEMENT = /^(align-self|justify-self|order|position|float|inset|top|right|bottom|left)$/;

    const offenders: string[] = [];
    for (const rule of RULES) {
      for (const selector of rule.selectors) {
        // Modifiers and states are exempt — opting in is the supported route.
        if (!PRIMITIVES.includes(selector)) continue;
        for (const { property, value } of readDeclarations(rule)) {
          if (PLACEMENT.test(property)) {
            offenders.push(`${selector} { ${property}: ${value} }`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no at-rules or nesting, which is what makes the reader above exact', () => {
    expect(SOURCE_WITHOUT_COMMENTS).not.toContain('@');
    // Every brace pair the reader found accounts for the whole file: no rule
    // body may itself contain a brace.
    const braces = (SOURCE_WITHOUT_COMMENTS.match(/[{}]/g) ?? []).length;
    expect(braces).toBe(RULES.length * 2);
  });
});

describe('the scales are actually applied', () => {
  const SCALE_PROPERTIES =
    /^(font-size|padding|padding-(top|right|bottom|left)|margin|margin-(top|right|bottom|left)|gap|row-gap|column-gap)$/;

  it('sizes text and space from the matching scale, not merely from some token', () => {
    // Each property family is pinned to its OWN scale. Accepting any `var()`
    // proves "this is a custom property", not "this is on the 4px grid": the
    // review planted `margin: var(--sidebar-width)` — a 320px margin — and the
    // old assertion passed it (docs/reviews/unit 8.md F4).
    const SCALE_FOR: [RegExp, RegExp, string][] = [
      [/^font-size$/, /^var\(--text-[a-z0-9]+\)$/, '--text-*'],
      [
        /^(padding|margin)(-(top|right|bottom|left))?$|^(row-|column-)?gap$/,
        /^var\(--space-\d+\)$/,
        '--space-*',
      ],
    ];

    for (const { property, value, selector } of DECLARATIONS) {
      if (property.startsWith('--')) continue;
      if (!SCALE_PROPERTIES.test(property)) continue;
      const scale = SCALE_FOR.find(([properties]) => properties.test(property));
      expect(scale, `${property} is in SCALE_PROPERTIES but has no scale`).toBeDefined();
      const [, allowed, name] = scale!;
      for (const part of value.split(' ')) {
        expect(
          part === '0' || part === 'auto' || allowed.test(part),
          `${selector} { ${property}: ${value} } — "${part}" is not on the ${name} scale`,
        ).toBe(true);
      }
    }
  });

  it('rounds corners from the radius scale (or a full circle)', () => {
    for (const { property, value, selector } of DECLARATIONS) {
      if (property !== 'border-radius') continue;
      for (const part of value.split(' ')) {
        expect(
          part === '50%' || /^var\(--radius-[a-z]+\)$/.test(part),
          `${selector} { border-radius: ${value} }`,
        ).toBe(true);
      }
    }
  });

  it('defines no custom property it never uses', () => {
    // The other half of the check below. A scale with steps nothing renders is
    // partly aspirational — the review found an 18px type step, a 32px space
    // step and a 12px radius sitting unused, one of them pinned by a test that
    // therefore guarded nothing (docs/reviews/unit 8.md F5).
    const used = new Set(
      [...SOURCE_WITHOUT_COMMENTS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]),
    );
    const unused = Object.keys(TOKENS).filter((token) => !used.has(token));
    expect(unused).toEqual([]);
  });

  it('references no custom property it does not define', () => {
    // A typo in `var(--ink-mutd)` is invisible: the declaration is dropped and
    // the element inherits something plausible. Nothing else would catch it.
    for (const { value, property, selector } of DECLARATIONS) {
      for (const match of value.matchAll(/var\((--[a-z0-9-]+)/g)) {
        expect(
          TOKENS[match[1]],
          `${selector} { ${property} } uses ${match[1]}, which :root does not define`,
        ).toBeDefined();
      }
    }
  });
});

describe('focus and motion', () => {
  // Every one of these removes or replaces the browser's own button/input
  // chrome, so each has to draw its own focus ring. A keyboard user losing the
  // caret is not a cosmetic bug.
  const INTERACTIVE = [
    '.btn',
    '.link-button',
    '.field__control',
    '.field__file',
    '.view-switcher__button',
    '.pin-list__row',
    '.banner__undo',
  ];

  it.each(INTERACTIVE)('%s draws a visible focus ring', (base) => {
    const rule = RULES.find((r) => r.selectors.includes(`${base}:focus-visible`));
    expect(rule, `no ${base}:focus-visible rule`).toBeDefined();
    expect(rule!.body).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it('never suppresses an outline', () => {
    expect(SOURCE_WITHOUT_COMMENTS).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });

  it('animates only color and shadow, so the sheet needs no reduced-motion block', () => {
    // `prefers-reduced-motion` exists for movement — transforms, position,
    // anything that travels. This sheet carries no such block, and that is
    // only honest while nothing here animates movement.
    const ANIMATABLE = new Set(['background-color', 'border-color', 'color', 'box-shadow']);
    const transitions = DECLARATIONS.filter((d) => d.property.startsWith('transition'));
    expect(transitions.length).toBeGreaterThan(0);
    for (const { value, selector } of transitions) {
      for (const part of value.split(',')) {
        const property = part.trim().split(' ')[0];
        expect(ANIMATABLE.has(property), `${selector} transitions ${property}`).toBe(true);
      }
    }
  });
});
