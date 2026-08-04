import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ImportExport } from './ImportExport';
import { serializePins } from '../storage/pinStore';
import type { Pin } from '../domain/pin';

afterEach(() => {
  cleanup();
  // Several export tests spy on URL.createObjectURL/revokeObjectURL and
  // HTMLAnchorElement.prototype.click with an explicit mockRestore() at the
  // end of the test body; if an assertion earlier in the test throws first,
  // that restore is skipped and the mock would otherwise leak into later
  // tests. This is the backstop regardless of where a test fails.
  vi.restoreAllMocks();
});

const alpha: Pin = {
  id: 'a',
  name: 'Alpha Cafe',
  lat: 40.7,
  lng: -74,
  strength: 'strong',
  notes: 'Alpha notes.',
};
const beta: Pin = {
  id: 'b',
  name: 'Beta Grill',
  lat: 0,
  lng: 0,
  strength: 'weak',
  notes: '',
};

function fileInput(): HTMLInputElement {
  return document.querySelector('input[type="file"]') as HTMLInputElement;
}

function selectFile(contents: string, name = 'leads.json') {
  const file = new File([contents], name, { type: 'application/json' });
  const input = fileInput();
  // A real browser populates a file input's `.value` with a fakepath when a
  // file is chosen; jsdom's `fireEvent.change` never does, which is exactly
  // what made the reset-after-selection test below vacuous (F7). Seed a
  // stand-in value so that assertion has something real to observe.
  Object.defineProperty(input, 'value', {
    value: `C:\\fakepath\\${name}`,
    writable: true,
    configurable: true,
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ImportExport — export', () => {
  it('downloads a blob containing exactly serializePins(pins), named with the date', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    render(<ImportExport pins={[alpha, beta]} getSavedCount={() => 2} onImport={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /export as json/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    await expect(blob.text()).resolves.toBe(serializePins([alpha, beta]));
  });

  // F6: nothing previously asserted on the anchor itself, so deleting
  // `a.download = exportFilename()`, `URL.revokeObjectURL(url)` or
  // `document.body.removeChild(a)` all left the suite green. These are the
  // lines that turn "save a file" into an actual download rather than a
  // silent no-op or a navigation away from the app.
  it('sets the download filename on the anchor and cleans up after clicking it', () => {
    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    const removeChild = vi.spyOn(document.body, 'removeChild');

    render(<ImportExport pins={[alpha]} getSavedCount={() => 1} onImport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /export as json/i }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toMatch(/^restaurant-map-\d{4}-\d{2}-\d{2}\.json$/);
    expect(clicked[0].href).toMatch(/^blob:/);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(removeChild).toHaveBeenCalledTimes(1);
  });
});

describe('ImportExport — import', () => {
  // The confirmation step must name BOTH counts — the file must never be
  // applied straight from picking it.
  it('shows a pending confirmation naming both counts, and does not import yet', async () => {
    const onImport = vi.fn();
    render(<ImportExport pins={[alpha, beta]} getSavedCount={() => 2} onImport={onImport} />);

    selectFile(serializePins([alpha]), 'one-lead.json');

    await waitFor(() =>
      expect(screen.getByText(/replace 2 saved leads with the 1 lead/i)).toBeTruthy(),
    );
    expect(screen.getByText(/one-lead\.json/)).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
  });

  // F2: the confirmation must name what's actually in storage, not the
  // `pins` prop — the two can diverge (another tab wrote since this one
  // loaded). getSavedCount stands in for "read storage right now".
  it('names the count getSavedCount reports, not pins.length, when they diverge', async () => {
    const onImport = vi.fn();
    render(<ImportExport pins={[alpha, beta]} getSavedCount={() => 5} onImport={onImport} />);

    selectFile(serializePins([alpha]), 'one-lead.json');

    await waitFor(() =>
      expect(screen.getByText(/replace 5 saved leads with the 1 lead/i)).toBeTruthy(),
    );
  });

  it('says the saved data is unreadable rather than naming a count when getSavedCount returns null', async () => {
    const onImport = vi.fn();
    render(
      <ImportExport pins={[alpha]} getSavedCount={() => null} onImport={onImport} />,
    );

    selectFile(serializePins([alpha]));

    await waitFor(() =>
      expect(screen.getByText(/replace the saved data \(currently unreadable\)/i)).toBeTruthy(),
    );
  });

  it('calls onImport with the parsed pins only after Replace is clicked', async () => {
    const onImport = vi.fn();
    const imported = [alpha];
    render(<ImportExport pins={[alpha, beta]} getSavedCount={() => 2} onImport={onImport} />);

    selectFile(serializePins(imported));
    await waitFor(() => screen.getByRole('button', { name: /^replace$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^replace$/i }));

    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledWith(imported);
  });

  it('discards the pending import on Cancel without calling onImport', async () => {
    const onImport = vi.fn();
    render(<ImportExport pins={[alpha, beta]} getSavedCount={() => 2} onImport={onImport} />);

    selectFile(serializePins([alpha]));
    await waitFor(() => screen.getByRole('button', { name: /cancel/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('button', { name: /^replace$/i })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
    // Back to the normal controls.
    expect(screen.getByRole('button', { name: /export as json/i })).toBeTruthy();
  });

  // Boundary/edge case: an invalid file must show a named error and never
  // reach the confirmation step.
  it('shows an error for an invalid file and never offers to import it', async () => {
    const onImport = vi.fn();
    render(<ImportExport pins={[alpha]} getSavedCount={() => 1} onImport={onImport} />);

    selectFile(JSON.stringify([{ id: 'x', name: 'y', lat: 0, lng: 0, strength: 'lukewarm' }]));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/invalid pin/i));
    expect(screen.queryByRole('button', { name: /^replace$/i })).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });

  // F10: the boundary (parsePin, via parseImportPayload) already knows
  // exactly which field of which record was wrong; the UI used to discard
  // that and show only the generic "the file contains an invalid pin",
  // which is unfixable information for a hand-edited JSON file.
  it('surfaces the specific reason a record was rejected, not just a generic message', async () => {
    render(<ImportExport pins={[alpha]} getSavedCount={() => 1} onImport={() => {}} />);

    selectFile(JSON.stringify([{ id: 'x', name: 'y', lat: 0, lng: 0, strength: 'lukewarm' }]));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/got "lukewarm"/i),
    );
  });

  it('rejects a non-array payload and a duplicate-id file, each with a named error', async () => {
    render(<ImportExport pins={[alpha]} getSavedCount={() => 1} onImport={() => {}} />);

    selectFile(JSON.stringify({ not: 'an array' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/array/i));

    selectFile(serializePins([alpha, { ...beta, id: alpha.id }]));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/duplicate/i));
  });

  // Retrying: selecting a file, having it rejected, then picking the SAME
  // file again after fixing it must still fire onChange.
  it('resets the file input after every selection so the same file can be retried', () => {
    render(<ImportExport pins={[alpha]} getSavedCount={() => 1} onImport={() => {}} />);
    selectFile(JSON.stringify({ bad: true }));
    expect(fileInput().value).toBe('');
  });

  // F11: picking a second file before the first one's FileReader has
  // resolved used to let whichever callback fired last win, regardless of
  // which file the user actually sees selected — a stale read could show a
  // confirmation for the abandoned file, or silently eat the real error.
  // Both selections happen before either FileReader.onload has a chance to
  // run, reproducing that race.
  it('ignores a stale file read superseded by a later selection', async () => {
    render(<ImportExport pins={[alpha]} getSavedCount={() => 1} onImport={() => {}} />);

    selectFile(serializePins([alpha]), 'good.json');
    selectFile(JSON.stringify({ not: 'an array' }), 'bad.json');

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/array/i));
    expect(screen.queryByText(/good\.json/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^replace$/i })).toBeNull();
  });
});
