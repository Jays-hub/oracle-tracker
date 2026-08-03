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
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={() => {}} />);
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
      <PinEditor key={alpha.id} pin={alpha} onSave={() => {}} onClose={() => {}} />,
    );
    fireEvent.change(notesBox(), { target: { value: 'UNSAVED TEXT TYPED ON ALPHA' } });
    expect(notesBox().value).toBe('UNSAVED TEXT TYPED ON ALPHA');

    rerender(
      <PinEditor key={beta.id} pin={beta} onSave={() => {}} onClose={() => {}} />,
    );
    expect(notesBox().value).toBe('Beta notes.');
    expect(screen.queryByDisplayValue('UNSAVED TEXT TYPED ON ALPHA')).toBeNull();
  });

  it('sends the edited fields to onSave', () => {
    const onSave = vi.fn();
    render(<PinEditor pin={alpha} onSave={onSave} onClose={() => {}} />);
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
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={() => {}} />);
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
    render(<PinEditor pin={alpha} onSave={() => {}} onClose={onClose} />);
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();

    fireEvent.change(notesBox(), { target: { value: 'typed something' } });
    const discard = screen.getByRole('button', { name: /discard changes/i });
    fireEvent.click(discard);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
