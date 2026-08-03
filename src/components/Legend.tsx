import {
  LEAD_STRENGTHS,
  STRENGTH_LABELS,
  colorForStrength,
} from '../domain/leadStrength';

export function Legend() {
  return (
    <ul className="legend" aria-label="Lead strength colors">
      {LEAD_STRENGTHS.map((s) => (
        <li key={s} className="legend__item">
          <span
            className="legend__swatch"
            style={{ background: colorForStrength(s) }}
          />
          {STRENGTH_LABELS[s]}
        </li>
      ))}
    </ul>
  );
}
