import { useState } from 'react';
import {
  LEAD_STRENGTHS,
  STRENGTH_LABELS,
  colorForStrength,
  type LeadStrength,
} from '../domain/leadStrength';
import type { Pin } from '../domain/pin';

/**
 * Edit one pin: its notes, its name, and its lead strength.
 *
 * The draft lives here as local state, seeded from the pin. App mounts this
 * with `key={pin.id}`, so selecting a different pin REMOUNTS the editor and the
 * draft is re-seeded — without that, unsaved text from pin A would appear (and
 * could be saved) under pin B.
 */
export function PinEditor({
  pin,
  onSave,
  onClose,
  onDelete,
}: {
  pin: Pin;
  onSave: (edits: { name: string; strength: LeadStrength; notes: string }) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(pin.name);
  const [strength, setStrength] = useState<LeadStrength>(pin.strength);
  const [notes, setNotes] = useState(pin.notes);
  // Delete is destructive, so it's a two-step arm/confirm like import's
  // Replace, not a single click. Local state is fine here — App remounts this
  // component with key={pin.id} on every selection change, so switching to a
  // different pin (or a successful delete, which clears selection) always
  // resets this back to unarmed rather than leaking a stale confirmation.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Compare against the stored pin using the same normalization the domain
  // applies on save, so "typed a trailing space" doesn't read as a change.
  const trimmedName = name.trim();
  const dirty =
    trimmedName !== pin.name ||
    strength !== pin.strength ||
    notes.trim() !== pin.notes;
  const canSave = trimmedName.length > 0 && dirty;

  return (
    <form
      className="pin-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ name, strength, notes });
      }}
    >
      <h2 className="pin-editor__title">
        <span
          className="pin-editor__swatch"
          style={{ background: colorForStrength(pin.strength) }}
        />
        Edit lead
      </h2>

      <label className="pin-editor__field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label className="pin-editor__field">
        <span>Lead strength</span>
        <select
          value={strength}
          onChange={(e) => setStrength(e.target.value as LeadStrength)}
        >
          {LEAD_STRENGTHS.map((s) => (
            <option key={s} value={s}>
              {STRENGTH_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <label className="pin-editor__field">
        <span>Notes</span>
        <textarea
          value={notes}
          placeholder="What happened on the visit? Who did you talk to?"
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className="pin-editor__actions">
        <button type="submit" disabled={!canSave}>
          Save changes
        </button>
        {/* Closing discards the draft, so the label has to say so while there
            is something to lose. "Done" read as a commit verb sitting next to
            Save — the one place a user could throw away typed notes thinking
            they had kept them. */}
        <button type="button" className="pin-editor__close" onClick={onClose}>
          {dirty ? 'Discard changes' : 'Close'}
        </button>
      </div>

      {trimmedName.length === 0 ? (
        <p className="pin-editor__hint pin-editor__hint--warn">
          A lead needs a name to be saved.
        </p>
      ) : (
        <p
          className={`pin-editor__hint${dirty ? ' pin-editor__hint--warn' : ''}`}
        >
          {dirty ? 'Unsaved changes — not saved yet.' : 'Saved.'}
        </p>
      )}

      <p className="pin-editor__coords">
        {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
      </p>

      {confirmingDelete ? (
        <div className="pin-editor__confirm-delete">
          <p>Delete “{pin.name}”? You’ll get a chance to undo right after.</p>
          <div className="pin-editor__actions">
            <button
              type="button"
              className="pin-editor__delete-confirm"
              onClick={() => onDelete(pin.id)}
            >
              Delete lead
            </button>
            <button
              type="button"
              className="pin-editor__cancel-delete"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="pin-editor__delete"
          onClick={() => setConfirmingDelete(true)}
        >
          Delete lead
        </button>
      )}
    </form>
  );
}
