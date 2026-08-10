/** Which surface the main pane shows. Purely UI state — never persisted, never touches storage. */
export type MainView = 'map' | 'list';

const VIEWS: { id: MainView; label: string }[] = [
  { id: 'map', label: 'Map' },
  { id: 'list', label: 'List' },
];

export function ViewSwitcher({
  view,
  onChange,
}: {
  view: MainView;
  onChange: (view: MainView) => void;
}) {
  return (
    <div className="view-switcher" role="group" aria-label="Choose view">
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          className={`view-switcher__button${
            view === id ? ' view-switcher__button--active' : ''
          }`}
          aria-pressed={view === id}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
