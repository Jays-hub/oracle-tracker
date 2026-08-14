import {
  LEAD_STRENGTHS,
  STRENGTH_LABELS,
  colorForStrength,
} from '../domain/leadStrength';

/**
 * The map's colour key.
 *
 * The visible title is not decoration: every other sidebar block announces
 * itself, and the redesign drew a hairline box around this one directly beneath
 * the filter's own Strong/Weak/Failed swatch list — two adjacent, visually
 * identical, unlabelled colour lists (docs/reviews/unit 8.md F7). The `ul` keeps
 * its own `aria-label`, which is more specific than the heading.
 */
export function Legend() {
  return (
    <div className="legend-block">
      <p className="overline">Lead strength</p>
      <ul className="legend" aria-label="Lead strength colors">
        {LEAD_STRENGTHS.map((s) => (
          <li key={s} className="legend__item">
            <span
              className="swatch"
              style={{ background: colorForStrength(s) }}
            />
            {STRENGTH_LABELS[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
