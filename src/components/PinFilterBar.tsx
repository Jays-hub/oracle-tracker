import {
  LEAD_STRENGTHS,
  STRENGTH_LABELS,
  colorForStrength,
  type LeadStrength,
} from '../domain/leadStrength';
import type { PinFilter } from '../domain/pinFilter';

export function PinFilterBar({
  filter,
  isActive,
  onToggleStrength,
  onQueryChange,
  onClear,
}: {
  filter: PinFilter;
  isActive: boolean;
  onToggleStrength: (strength: LeadStrength) => void;
  onQueryChange: (query: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="pin-filter">
      <input
        type="search"
        className="pin-filter__search"
        aria-label="Search leads by name or notes"
        placeholder="Search name or notes…"
        value={filter.query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <fieldset className="pin-filter__strengths">
        <legend className="pin-filter__legend">Show</legend>
        {LEAD_STRENGTHS.map((s) => (
          <label key={s} className="pin-filter__strength">
            <input
              type="checkbox"
              checked={filter.strengths.has(s)}
              onChange={() => onToggleStrength(s)}
            />
            <span
              className="pin-filter__swatch"
              style={{ background: colorForStrength(s) }}
            />
            {STRENGTH_LABELS[s]}
          </label>
        ))}
      </fieldset>
      {isActive && (
        <button type="button" className="pin-filter__clear" onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
