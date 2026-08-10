/**
 * Thin wrapper over the File System Access API — the mechanism that lets
 * Unit 6 point storage at a real file on disk (`data/pins.json`) instead of
 * `localStorage`, with no server in between: committing/pushing/pulling that
 * file through the user's normal git workflow is the sync. Every function
 * here is small and takes a handle as a parameter (rather than closing over
 * one), so it's testable against a plain object that implements the same
 * shape as a real `FileSystemFileHandle` — no real browser API required.
 */

/**
 * Feature-detected, not UA-sniffed: only Chromium browsers implement the
 * File System Access API today, but checking for the functions themselves
 * (rather than sniffing the user agent) is what keeps this correct as other
 * browsers add support.
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showOpenFilePicker === 'function' &&
    typeof window.showSaveFilePicker === 'function'
  );
}

const PICKER_OPTIONS: FilePickerOptions = {
  types: [
    {
      description: 'restaurant-map pins',
      accept: { 'application/json': ['.json'] },
    },
  ],
};

/** Prompt the user to pick an existing file. Rejects (AbortError) if cancelled. */
export async function pickExistingFile(): Promise<FileSystemFileHandle> {
  const [handle] = await window.showOpenFilePicker(PICKER_OPTIONS);
  return handle;
}

/**
 * Prompt the user to choose a save location — may resolve to a brand-new
 * file or an existing one the user selected to overwrite; the caller can't
 * tell which from the handle alone and has to read it to find out (see
 * `docs/build_notes/Unit 6 - git syncable storage.md`). Rejects (AbortError)
 * if cancelled.
 */
export async function createNewFile(): Promise<FileSystemFileHandle> {
  return window.showSaveFilePicker({ ...PICKER_OPTIONS, suggestedName: 'pins.json' });
}

/** Current read/write permission for `handle`, without prompting the user. */
export function queryReadWritePermission(
  handle: FileSystemFileHandle,
): Promise<PermissionState> {
  return handle.queryPermission({ mode: 'readwrite' });
}

/**
 * Ask the user to grant read/write permission for `handle`. Must be called
 * from inside a user-gesture event handler (a click) — calling it from an
 * effect on mount will reject or hang, which is exactly why the mount-time
 * reconnect flow calls `queryReadWritePermission` first and only surfaces a
 * "Reconnect" button (whose click *is* the gesture) when that isn't enough.
 */
export function requestReadWritePermission(
  handle: FileSystemFileHandle,
): Promise<PermissionState> {
  return handle.requestPermission({ mode: 'readwrite' });
}

/** Read the file's full text content. */
export async function readFile(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

/**
 * Overwrite the file's full contents. Aborts the write (discarding whatever
 * was buffered) rather than closing it if `write` itself fails, so a failed
 * write can't leave a half-written file on disk — `close()` is what commits
 * the swap, and committing a partial write would be worse than leaving the
 * file exactly as it was.
 */
export async function writeFile(
  handle: FileSystemFileHandle,
  data: string,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (cause) {
    try {
      await writable.abort();
    } catch {
      // Best effort: the write already failed, so if abort ALSO fails there's
      // nothing more this function can do — the original cause is what the
      // caller needs to see.
    }
    throw cause;
  }
}
