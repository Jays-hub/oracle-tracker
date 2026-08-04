import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PinEditor } from './PinEditor';
import type { Pin } from '../domain/pin';

afterEach(cleanup);

const alpha: Pin = {
  id: 'a',
  name: 'Alpha Cafe',
  lat: 1,
  lng: 1,
  strength: 'strong',
  notes: 'Alpha notes.',
};
const beta: Pin = {
  id: 'b',
  name: 'Beta Grill',
  lat: 2,
  lng: 2,
  strength: 'weak',
  notes: 'Beta notes.',
};

function notesBox() {
  return screen.getByPlaceholderText(/what happened on the visit/i) as HTMLTextAreaElement;
}

describe('PinEditor', () => {
  it('seeds the draft from the pin it is given', () => {
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(notesBox().value).toBe('Alpha notes.');
    expect((screen.getByDisplayValue('Alpha Cafe') as HTMLInputElement).value).toBe(
      'Alpha Cafe',
    );
  });

  // THE guard this unit hangs on. App renders <PinEditor key={pin.id}>, so
  // selecting another pin must remount and re-seed. Removing that key makes
  // this test fail — without it, notes typed on one lead get saved onto
  // another, which is silent and unrecoverable. Rendering with an explicit key
  // is what makes this a test of the key contract and not of React internals.
  it('does not carry an unsaved draft across to a different pin', () => {
    const { rerender } = render(
      <PinEditor key={alpha.id} pin={alpha} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />,
    );
    fireEvent.change(notesBox(), { target: { value: 'UNSAVED TEXT TYPED ON ALPHA' } });
    expect(notesBox().value).toBe('UNSAVED TEXT TYPED ON ALPHA');

    rerender(
      <PinEditor key={beta.id} pin={beta} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(notesBox().value).toBe('Beta notes.');
    expect(screen.queryByDisplayValue('UNSAVED TEXT TYPED ON ALPHA')).toBeNull();
  });

  it('sends the edited fields to onSave', () => {
    const onSave = vi.fn();
    render(<PinEditor pin={alpha} onSave={onSave} onClose={() => {}} onDelete={() => {}} />);
    fireEvent.change(notesBox(), { target: { value: 'Signed a trial.' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Alpha Cafe',
      strength: 'strong',
      notes: 'Signed a trial.',
    });
  });

  // Save must be impossible when there is nothing to save or nothing valid to
  // save — a no-op write would still rewrite the whole store.
  it('disables Save until there is a real change, and blocks an empty name', () => {
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />);
    const save = screen.getByRole('button', { name: /save changes/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(notesBox(), { target: { value: 'changed' } });
    expect(save.disabled).toBe(false);

    fireEvent.change(screen.getByDisplayValue('Alpha Cafe'), { target: { value: '  ' } });
    expect(save.disabled).toBe(true);
  });

  // The close button discards the draft, so its label must not read as a commit.
  it('labels the close button as discarding once the draft is dirty', () => {
    const onClose = vi.fn();
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={onClose} onDelete={() => {}} />);
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();

    fireEvent.change(notesBox(), { target: { value: 'typed something' } });
    const discard = screen.getByRole('button', { name: /discard changes/i });
    fireEvent.click(discard);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Delete is destructive, so a single click must not be enough to do it —
  // it has to arm a confirmation first, matching the two-step pattern
  // ImportExport already uses for its own destructive Replace.
  it('requires a confirmation before calling onDelete', () => {
    const onDelete = vi.fn();
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={() => {}} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText(/delete “alpha cafe”/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    expect(onDelete).toHaveBeenCalledWith('a');
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // Cancelling the confirmation must leave the pin alone.
  it('does not call onDelete when the delete confirmation is cancelled', () => {
    const onDelete = vi.fn();
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={() => {}} onDelete={onDelete} />);

    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText(/delete “alpha cafe”/i)).toBeNull();
    // The confirmation collapsed back to the single armed button, not gone entirely.
    expect(screen.getByRole('button', { name: /^delete lead$/i })).toBeTruthy();
  });

  // Same remount contract as the draft-carry-over guard above: switching pins
  // must not leave a stale "are you sure?" armed under a DIFFERENT pin than
  // the one the user meant to delete.
  it('resets an armed delete confirmation when remounted for a different pin', () => {
    const { rerender } = render(
      <PinEditor key={alpha.id} pin={alpha} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^delete lead$/i }));
    expect(screen.getByText(/delete “alpha cafe”/i)).toBeTruthy();

    rerender(
      <PinEditor key={beta.id} pin={beta} onSave={() => {}} onClose={() => {}} onDelete={() => {}} />,
    );
    expect(screen.queryByText(/delete “alpha cafe”/i)).toBeNull();
    expect(screen.queryByText(/delete “beta grill”/i)).toBeNull();
  });
});
