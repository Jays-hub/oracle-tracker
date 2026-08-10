/**
 * An in-memory stand-in for `FileSystemFileHandle`, shared by every test that
 * needs one (fileStorage's own unit tests, and App's linked-file integration
 * tests) so the fake's behaviour — writes only land on `close()`, `abort()`
 * discards them, permission is queryable/requestable and can change mid-test
 * — is defined once rather than reimplemented per test file with subtly
 * different bugs.
 */
export interface FakeFileHandle extends FileSystemFileHandle {
  /** Test-only escape hatch: the content actually committed by `close()`. */
  readonly committed: string;
  /** Test-only escape hatch: change what queryPermission answers going forward. */
  setPermission(permission: PermissionState): void;
}

export function fakeFileHandle(
  initialContent: string,
  options: {
    name?: string;
    /** What queryPermission (the ambient, non-prompting check) answers. */
    permission?: PermissionState;
    /**
     * What requestPermission (the one a user gesture can trigger) resolves
     * to. Defaults to `permission` — most tests don't care about the
     * query/request distinction — but can be set separately to simulate the
     * real-world "was prompt, user explicitly granted/denied it just now"
     * case a reconnect flow exercises. A successful request updates what a
     * later queryPermission answers too, same as a real permission grant.
     */
    requestResult?: PermissionState;
  } = {},
): FakeFileHandle {
  const name = options.name ?? 'pins.json';
  let content = initialContent;
  let queryState: PermissionState = options.permission ?? 'granted';
  const requestResult: PermissionState = options.requestResult ?? queryState;

  const handle: FakeFileHandle = {
    kind: 'file',
    name,
    get committed() {
      return content;
    },
    setPermission(next) {
      queryState = next;
    },
    async getFile() {
      return new File([content], name, { type: 'application/json' });
    },
    async createWritable() {
      let buffer = '';
      let closed = false;
      const stream = {
        async write(data: FileSystemWriteChunkType) {
          if (closed) throw new Error('write after close');
          buffer += typeof data === 'string' ? data : String(data);
        },
        async close() {
          closed = true;
          content = buffer;
        },
        async abort() {
          closed = true;
        },
      };
      return stream as unknown as FileSystemWritableFileStream;
    },
    async isSameEntry(other) {
      return other === handle;
    },
    async queryPermission() {
      return queryState;
    },
    async requestPermission() {
      queryState = requestResult;
      return requestResult;
    },
  };

  return handle;
}
