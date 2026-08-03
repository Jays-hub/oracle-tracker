import { LEAD_STRENGTHS, STRENGTH_LABELS, type LeadStrength } from '../domain/leadStrength';

export function AddPinForm({
  name,
  strength,
  armed,
  onNameChange,
  onStrengthChange,
  onArm,
  onCancel,
}: {
  name: string;
  strength: LeadStrength;
  armed: boolean;
  onNameChange: (name: string) => void;
  onStrengthChange: (strength: LeadStrength) => void;
  onArm: () => void;
  onCancel: () => void;
}) {
  const canArm = name.trim().length > 0;

  return (
    <form
      className="add-pin"
      onSubmit={(e) => {
        e.preventDefault();
        if (canArm) onArm();
      }}
    >
      <h2 className="add-pin__title">Add a restaurant</h2>

      <label className="add-pin__field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          placeholder="e.g. Joe's Diner"
          onChange={(e) => onNameChange(e.target.value)}
          disabled={armed}
        />
      </label>

      <label className="add-pin__field">
        <span>Lead strength</span>
        <select
          value={strength}
          onChange={(e) => onStrengthChange(e.target.value as LeadStrength)}
          disabled={armed}
        >
          {LEAD_STRENGTHS.map((s) => (
            <option key={s} value={s}>
              {STRENGTH_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      {armed ? (
        <div className="add-pin__armed">
          <p>Click the map to place “{name.trim()}”.</p>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="submit" disabled={!canArm}>
          Place on map…
        </button>
      )}
      {!canArm && !armed && (
        <p className="add-pin__hint">Enter a name to place a pin.</p>
      )}
    </form>
  );
}
