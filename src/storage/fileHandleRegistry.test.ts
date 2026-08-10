import { describe, it, expect } from 'vitest';
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { rememberFileHandle, recallFileHandle, forgetFileHandle } from './fileHandleRegistry';

/**
 * A fresh `FDBFactory` per test — an independent in-memory IndexedDB, so
 * tests can't see each other's writes. `window.indexedDB`/global `indexedDB`
 * is never touched, matching how `pinStore.test.ts` injects a `StorageLike`
 * instead of touching real `localStorage`.
 *
 * The value stored is a plain structurally-cloneable stand-in, not this
 * project's `fakeFileHandle` test double: real IndexedDB can store a real
 * `FileSystemFileHandle` because browsers give that type special structured-
 * clone support, but fake-indexeddb's pure-JS clone can't serialize an
 * object with function properties (getFile, createWritable, ...) any more
 * than real structured clone can serialize an arbitrary function. That's a
 * fidelity gap in the fake, not in this module: `rememberFileHandle`/
 * `recallFileHandle` only orchestrate get/put/delete against whatever value
 * they're given, so a clonable stand-in still exercises that logic for real.
 */
function fakeHandle(name: string) {
  return { kind: 'file', name } as unknown as FileSystemFileHandle;
}

describe('fileHandleRegistry', () => {
  it('returns null when nothing has ever been remembered', async () => {
    const db = new FakeIDBFactory();
    await expect(recallFileHandle(db)).resolves.toBeNull();
  });

  it('round-trips a remembered handle', async () => {
    const db = new FakeIDBFactory();
    await rememberFileHandle(fakeHandle('pins.json'), db);
    const recalled = await recallFileHandle(db);
    expect(recalled).toEqual(fakeHandle('pins.json'));
  });

  it('replaces the previously remembered handle rather than keeping both', async () => {
    const db = new FakeIDBFactory();
    await rememberFileHandle(fakeHandle('first.json'), db);
    await rememberFileHandle(fakeHandle('second.json'), db);
    const recalled = await recallFileHandle(db);
    expect(recalled).toEqual(fakeHandle('second.json'));
  });

  it('forgetFileHandle clears the remembered handle', async () => {
    const db = new FakeIDBFactory();
    await rememberFileHandle(fakeHandle('pins.json'), db);
    await forgetFileHandle(db);
    await expect(recallFileHandle(db)).resolves.toBeNull();
  });

  it('forgetFileHandle on an empty registry is a harmless no-op', async () => {
    const db = new FakeIDBFactory();
    await expect(forgetFileHandle(db)).resolves.toBeUndefined();
    await expect(recallFileHandle(db)).resolves.toBeNull();
  });

  // Real browsers old enough to lack File System Access still virtually all
  // have IndexedDB, but this guards the degrade-safely path regardless: no
  // factory available must never throw, only no-op.
  it('is a safe no-op with no IDBFactory available (e.g. jsdom)', async () => {
    await expect(recallFileHandle(undefined)).resolves.toBeNull();
    await expect(rememberFileHandle(fakeHandle('pins.json'), undefined)).resolves.toBeUndefined();
    await expect(forgetFileHandle(undefined)).resolves.toBeUndefined();
  });
});
