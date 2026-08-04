import { useRef, useState, type ChangeEvent } from 'react';
import { serializePins } from '../storage/pinStore';
import { exportFilename, parseImportPayload } from '../storage/importExport';
import { leadNoun, type Pin } from '../domain/pin';

/** `err.message`, plus `err.cause`'s if it has one — the specific reason a
 * file was rejected (e.g. which field of which record), not just the
 * boundary's generic "the file contains an invalid pin". */
function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err.cause : undefined;
  return cause instanceof Error ? `${message}: ${cause.message}` : message;
}

/**
 * Export every pin to a JSON file, or replace the whole store from one.
 *
 * Import is destructive — a REPLACE, not a merge (docs/roadmap.md "Unit 3 —
 * Section B") — so a parsed file sits in `pending` behind an explicit
 * confirm/cancel step naming both counts before `onImport` ever runs.
 * Picking a file only parses it; nothing is committed until Replace is
 * clicked, and the parent (App) owns the actual store write.
 */
export function ImportExport({
  pins,
  getSavedCount,
  onImport,
}: {
  pins: Pin[];
  /** How many pins are actually in storage right now (null if unreadable) —
   * read fresh at selection time so the confirmation names what a replace
   * would really destroy, not this tab's possibly-stale `pins` prop. */
  getSavedCount: () => number | null;
  onImport: (pins: Pin[]) => void;
}) {
  const [pending, setPending] = useState<{
    pins: Pin[];
    fileName: string;
    savedCount: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only the most recently selected file's FileReader result is allowed to
  // land: if a user picks a second file before the first one finishes
  // reading, the first's callback must not overwrite what the second one
  // showed. Without this a stale read can win the race and show a confirm
  // step (or silence an error) for a file that isn't the one on screen
  // anymore (docs/reviews/Unit 3 Section B - export-import JSON.md F11).
  const selectionRef = useRef(0);

  function handleExport() {
    const blob = new Blob([serializePins(pins)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Reset now, not just on success: without this, re-picking the SAME file
    // (e.g. after fixing it and trying again) would not re-fire onChange, and
    // a rejected file could never be retried.
    e.target.value = '';
    if (!file) return;

    const selection = ++selectionRef.current;
    setError(null);
    setPending(null);
    const reader = new FileReader();
    reader.onload = () => {
      if (selection !== selectionRef.current) return; // superseded, drop it
      try {
        const imported = parseImportPayload(String(reader.result));
        setPending({ pins: imported, fileName: file.name, savedCount: getSavedCount() });
      } catch (err) {
        setError(describeError(err));
      }
    };
    reader.onerror = () => {
      if (selection !== selectionRef.current) return;
      setError('Could not read that file.');
    };
    reader.readAsText(file);
  }

  if (pending) {
    const savedLabel =
      pending.savedCount === null
        ? 'the saved data (currently unreadable)'
        : `${pending.savedCount} saved ${leadNoun(pending.savedCount)}`;
    return (
      <div className="import-export import-export--confirm">
        <p>
          Replace {savedLabel} with the {pending.pins.length}{' '}
          {leadNoun(pending.pins.length)} in “{pending.fileName}”?
        </p>
        <div className="import-export__actions">
          <button
            type="button"
            className="import-export__replace"
            onClick={() => {
              onImport(pending.pins);
              setPending(null);
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className="import-export__cancel"
            onClick={() => setPending(null)}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import-export">
      <p className="import-export__title">Backup</p>
      <div className="import-export__actions">
        <button type="button" onClick={handleExport}>
          Export as JSON
        </button>
      </div>
      <label className="import-export__file">
        <span>Import from JSON — replaces every saved lead</span>
        <input type="file" accept="application/json,.json" onChange={handleFileSelected} />
      </label>
      {error && (
        <p className="import-export__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
