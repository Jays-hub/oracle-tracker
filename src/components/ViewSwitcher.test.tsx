import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ViewSwitcher } from './ViewSwitcher';

afterEach(cleanup);

describe('ViewSwitcher', () => {
  it('marks exactly the active view as pressed', () => {
    render(<ViewSwitcher view="map" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Map' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('calls onChange with the clicked view, not the current one', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher view="map" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('list');
  });

  // Edge case: clicking the already-active view still reports it (the caller
  // decides whether that's a no-op) rather than silently swallowing the click.
  it('reports a click on the already-active view too', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher view="list" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));

    expect(onChange).toHaveBeenCalledWith('list');
  });
});
