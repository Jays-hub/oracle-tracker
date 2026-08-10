// @vitest-environment jsdom
//
// Everything else under src/storage/ is pure TS on the default `node`
// environment (see vite.config.ts), but this file exercises `window`,
// `File` and `DOMException` directly — the real DOM globals the File System
// Access API lives on — so it opts into jsdom per-file rather than moving
// the whole storage suite off `node`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isFileSystemAccessSupported,
  pickExistingFile,
  createNewFile,
  queryReadWritePermission,
  requestReadWritePermission,
  readFile,
  writeFile,
} from './fileStorage';
import { fakeFileHandle } from '../test/fakeFileHandle';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'showOpenFilePicker');
  Reflect.deleteProperty(window, 'showSaveFilePicker');
});

describe('isFileSystemAccessSupported', () => {
  // Feature-detected, not UA-sniffed: both picker functions must exist.
  it('is false when the picker functions are absent (most browsers today)', () => {
    expect(isFileSystemAccessSupported()).toBe(false);
  });

  it('is true once both picker functions are present', () => {
    window.showOpenFilePicker = vi.fn();
    window.showSaveFilePicker = vi.fn();
    expect(isFileSystemAccessSupported()).toBe(true);
  });

  it('is false when only one picker function is present', () => {
    window.showOpenFilePicker = vi.fn();
    expect(isFileSystemAccessSupported()).toBe(false);
  });
});

describe('pickExistingFile / createNewFile', () => {
  it('pickExistingFile calls showOpenFilePicker and returns the first handle', async () => {
    const handle = fakeFileHandle('[]');
    window.showOpenFilePicker = vi.fn().mockResolvedValue([handle]);
    await expect(pickExistingFile()).resolves.toBe(handle);
  });

  it('createNewFile calls showSaveFilePicker with a suggested filename', async () => {
    const handle = fakeFileHandle('');
    const showSaveFilePicker = vi.fn().mockResolvedValue(handle);
    window.showSaveFilePicker = showSaveFilePicker;
    await expect(createNewFile()).resolves.toBe(handle);
    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'pins.json' }),
    );
  });

  // Cancelling a native picker rejects with AbortError — callers must be able
  // to tell that apart from a real failure (see App's linkFile).
  it('propagates a cancelled picker as a rejection', async () => {
    window.showOpenFilePicker = vi
      .fn()
      .mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));
    await expect(pickExistingFile()).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('readFile / writeFile', () => {
  it('readFile returns the handle’s current text content', async () => {
    const handle = fakeFileHandle('[{"id":"1"}]');
    await expect(readFile(handle)).resolves.toBe('[{"id":"1"}]');
  });

  it('writeFile replaces the file’s full content and commits it', async () => {
    const handle = fakeFileHandle('old content');
    await writeFile(handle, 'new content');
    expect(handle.committed).toBe('new content');
    await expect(readFile(handle)).resolves.toBe('new content');
  });

  // A partial write must not land: if `write` throws mid-stream, the handle
  // must abort rather than close, so the file on disk keeps its old content
  // instead of silently truncating to whatever was buffered.
  it('aborts rather than closes, and rethrows, when the write itself fails', async () => {
    const handle = fakeFileHandle('original');
    let closed = false;
    let aborted = false;
    handle.createWritable = async () =>
      ({
        write: async () => {
          throw new Error('disk full');
        },
        close: async () => {
          closed = true;
        },
        abort: async () => {
          aborted = true;
        },
      }) as unknown as FileSystemWritableFileStream;

    await expect(writeFile(handle, 'new content')).rejects.toThrow('disk full');
    expect(aborted).toBe(true);
    expect(closed).toBe(false);
    expect(handle.committed).toBe('original'); // createWritable was replaced, so it was never touched
  });
});

describe('permission helpers', () => {
  it('queryReadWritePermission delegates to handle.queryPermission with mode readwrite', async () => {
    const handle = fakeFileHandle('[]', { permission: 'prompt' });
    await expect(queryReadWritePermission(handle)).resolves.toBe('prompt');
  });

  it('requestReadWritePermission delegates to handle.requestPermission with mode readwrite', async () => {
    const handle = fakeFileHandle('[]', { permission: 'denied' });
    await expect(requestReadWritePermission(handle)).resolves.toBe('denied');
  });

  it('reflects a permission change made mid-test', async () => {
    const handle = fakeFileHandle('[]', { permission: 'prompt' });
    handle.setPermission('granted');
    await expect(queryReadWritePermission(handle)).resolves.toBe('granted');
  });
});
