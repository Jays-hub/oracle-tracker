import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DataFileLink } from './DataFileLink';

afterEach(cleanup);

const noop = () => {};
const baseProps = {
  supported: true,
  linkedFileName: null,
  reconnectFileName: null,
  pendingLink: null,
  error: null,
  onChooseExisting: noop,
  onCreateNew: noop,
  onReconnect: noop,
  onConfirmLink: noop,
  onCancelLink: noop,
  onUnlink: noop,
};

describe('DataFileLink — unsupported browser', () => {
  it('shows an honest fallback note instead of the link controls, and no crash', () => {
    render(<DataFileLink {...baseProps} supported={false} />);
    expect(screen.getByText(/needs chrome or edge/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /choose existing file/i })).toBeNull();
  });
});

describe('DataFileLink — not yet linked', () => {
  it('offers both choose-existing and create-new, calling the right callback', () => {
    const onChooseExisting = vi.fn();
    const onCreateNew = vi.fn();
    render(
      <DataFileLink {...baseProps} onChooseExisting={onChooseExisting} onCreateNew={onCreateNew} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /choose existing file/i }));
    expect(onChooseExisting).toHaveBeenCalledTimes(1);
    expect(onCreateNew).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /create new file/i }));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

describe('DataFileLink — reconnect', () => {
  it('names the previously linked file and reconnects on click', () => {
    const onReconnect = vi.fn();
    render(<DataFileLink {...baseProps} reconnectFileName="pins.json" onReconnect={onReconnect} />);

    expect(screen.getByText(/pins\.json/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^reconnect$/i }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    // The choose/create controls must not also be showing at the same time.
    expect(screen.queryByRole('button', { name: /choose existing file/i })).toBeNull();
  });
});

describe('DataFileLink — linked', () => {
  it('shows the linked filename and no choose/create/reconnect controls', () => {
    render(<DataFileLink {...baseProps} linkedFileName="pins.json" />);
    expect(screen.getByText(/linked to “pins\.json”/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /choose existing file/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^reconnect$/i })).toBeNull();
  });

  // F8 (docs/reviews/Unit 6 - git syncable storage.md): once linked, Unlink
  // is the only in-app way back to localStorage — without it a broken link
  // has no escape hatch.
  it('offers an Unlink control that calls the callback', () => {
    const onUnlink = vi.fn();
    render(<DataFileLink {...baseProps} linkedFileName="pins.json" onUnlink={onUnlink} />);

    fireEvent.click(screen.getByRole('button', { name: /^unlink$/i }));
    expect(onUnlink).toHaveBeenCalledTimes(1);
  });
});

describe('DataFileLink — pending link confirmation', () => {
  it('names both counts and the filename, and only commits on confirm', () => {
    const onConfirmLink = vi.fn();
    const onCancelLink = vi.fn();
    render(
      <DataFileLink
        {...baseProps}
        pendingLink={{ fileName: 'backup.json', savedCount: 2, importCount: 5 }}
        onConfirmLink={onConfirmLink}
        onCancelLink={onCancelLink}
      />,
    );

    expect(screen.getByText(/backup\.json/)).toBeTruthy();
    expect(screen.getByText(/replacing 2 currently shown leads with the 5 leads/i)).toBeTruthy();
    expect(onConfirmLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancelLink).toHaveBeenCalledTimes(1);
    expect(onConfirmLink).not.toHaveBeenCalled();
  });

  it('says the shown data is unreadable rather than naming a count when savedCount is null', () => {
    render(
      <DataFileLink
        {...baseProps}
        pendingLink={{ fileName: 'backup.json', savedCount: null, importCount: 1 }}
      />,
    );
    expect(screen.getByText(/currently shown data \(unreadable\)/i)).toBeTruthy();
  });

  it('takes priority over an unsupported/linked/reconnect state', () => {
    render(
      <DataFileLink
        {...baseProps}
        supported={false}
        linkedFileName="already-linked.json"
        pendingLink={{ fileName: 'backup.json', savedCount: 1, importCount: 1 }}
      />,
    );
    expect(screen.getByText(/link “backup\.json”/i)).toBeTruthy();
    expect(screen.queryByText(/needs chrome or edge/i)).toBeNull();
  });
});

describe('DataFileLink — error', () => {
  it('shows a named error alongside whatever state is otherwise current', () => {
    render(<DataFileLink {...baseProps} error="Permission was not granted." />);
    expect(screen.getByRole('alert').textContent).toMatch(/permission was not granted/i);
  });
});
