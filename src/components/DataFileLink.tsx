import { leadNoun } from '../domain/pin';

/**
 * A pending link decided by App (an existing file's content needs an
 * explicit "replace what's shown with this file" confirmation, the same
 * shape Unit 3B's import confirmation uses) — never shown at the same time
 * as `reconnectFileName` or the choose/create controls.
 */
export interface PendingFileLink {
  fileName: string;
  /** How many leads are currently shown, about to be replaced. Null if unreadable. */
  savedCount: number | null;
  importCount: number;
}

/**
 * Sidebar control for Unit 6: link storage to a real file via the File
 * System Access API. Purely presentational — every File System Access call
 * lives in App, which is the only thing that needs `linkedHandle` in state;
 * this component just renders whichever of App's states is current and
 * forwards clicks.
 */
export function DataFileLink({
  supported,
  linkedFileName,
  reconnectFileName,
  pendingLink,
  error,
  reconnectPending = false,
  onChooseExisting,
  onCreateNew,
  onReconnect,
  onConfirmLink,
  onCancelLink,
  onUnlink,
}: {
  supported: boolean;
  /** The linked file's name, once every read/write goes through it. */
  linkedFileName: string | null;
  /** A handle recalled from a past session that needs one permission click. */
  reconnectFileName: string | null;
  pendingLink: PendingFileLink | null;
  error: string | null;
  /** A permission request is open. Disables Reconnect so a second prompt
   * can't stack on the first — never "Forget this file", which has to stay
   * clickable precisely while a prompt the user wants to abandon is up. */
  reconnectPending?: boolean;
  onChooseExisting: () => void;
  onCreateNew: () => void;
  onReconnect: () => void;
  onConfirmLink: () => void;
  onCancelLink: () => void;
  /** Forget the link and fall back to localStorage — the only way back once
   * linked, since there's no in-app "switch files" flow. */
  onUnlink: () => void;
}) {
  return (
    <div className="data-file-link">
      <p className="overline">Sync via file</p>

      {error && (
        <p className="data-file-link__error" role="alert">
          {error}
        </p>
      )}

      {pendingLink ? (
        <div className="panel panel--accent">
          <p className="panel__text">
            Link “{pendingLink.fileName}”, replacing{' '}
            {pendingLink.savedCount === null
              ? 'the currently shown data (unreadable)'
              : `${pendingLink.savedCount} currently shown ${leadNoun(pendingLink.savedCount)}`}{' '}
            with the {pendingLink.importCount} {leadNoun(pendingLink.importCount)} in that file?
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn--primary" onClick={onConfirmLink}>
              Link file
            </button>
            <button type="button" className="btn btn--secondary" onClick={onCancelLink}>
              Cancel
            </button>
          </div>
        </div>
      ) : !supported ? (
        <p className="data-file-link__note">
          Linking a data file needs Chrome or Edge. Using browser storage on this device.
        </p>
      ) : linkedFileName ? (
        <div className="data-file-link__linked">
          <p className="data-file-link__status">
            Linked to “{linkedFileName}”. Every read and write goes through this file — commit
            and push it to sync from another device.
          </p>
          <button type="button" className="btn btn--secondary" onClick={onUnlink}>
            Unlink
          </button>
        </div>
      ) : reconnectFileName ? (
        <div className="panel panel--accent">
          <p className="panel__text">
            This browser was linked to “{reconnectFileName}”. Reconnecting asks the browser
            for permission — its prompt opens at the top of the window, outside the page.
          </p>
          {/* "Forget" is not a convenience here, it's the only exit. Without it a
              remembered handle hides the choose/create controls indefinitely: a file
              that was renamed, deleted, or simply isn't the one you want now leaves
              Reconnect as the sole control, and it can only ever fail. Same handler
              the linked state's Unlink uses — forget the handle, fall back to
              browser storage, which restores the controls below. */}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--primary"
              onClick={onReconnect}
              disabled={reconnectPending}
            >
              {reconnectPending ? 'Waiting for permission…' : 'Reconnect'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={onUnlink}>
              Forget this file
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn btn--secondary" onClick={onChooseExisting}>
            Choose existing file…
          </button>
          <button type="button" className="btn btn--secondary" onClick={onCreateNew}>
            Create new file…
          </button>
        </div>
      )}
    </div>
  );
}
