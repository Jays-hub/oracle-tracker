import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMapEvents,
  type MapContainerProps,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colorForStrength, STRENGTH_LABELS } from '../domain/leadStrength';
import {
  CLOSE_UP_ZOOM,
  FIT_PADDING_PX,
  MARKER_SIZE_PX,
  type InitialView,
} from '../domain/mapFit';
import type { Pin } from '../domain/pin';
import type { PersistedView } from '../storage/viewStore';

// A colored dot marker. `color` comes only from our fixed STRENGTH_COLORS map
// and `selected` is a boolean, so nothing user-authored reaches the icon HTML.
function pinIcon(color: string, selected: boolean): L.DivIcon {
  const cls = `pin-marker__dot${selected ? ' pin-marker__dot--selected' : ''}`;
  return L.divIcon({
    className: 'pin-marker',
    html: `<span class="${cls}" style="background:${color}"></span>`,
    iconSize: [MARKER_SIZE_PX, MARKER_SIZE_PX],
    iconAnchor: [MARKER_SIZE_PX / 2, MARKER_SIZE_PX / 2],
    popupAnchor: [0, -12],
  });
}

function ClickCapture({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      // Wrap longitude into [-180, 180] so a click on a repeated world copy
      // (zoomed out + panned) still yields an in-range, placeable coordinate.
      const { lat, lng } = e.latlng.wrap();
      onClick(lat, lng);
    },
  });
  return null;
}

/**
 * Reports the map's own pan/zoom back to `onViewChange` whenever a user
 * gesture settles.
 *
 * Listens for `dragend` + `zoomend`, deliberately NOT `moveend`: `moveend` is
 * not a proxy for user intent — Leaflet fires it for a window resize too
 * (`trackResize` -> `invalidateSize({debounceMoveend: true})`), so a
 * `moveend` listener persists a view the user never chose, on nothing more
 * than a resized browser window or an opened devtools pane (see
 * docs/reviews/persist map view across reloads.md F3). `dragend` fires only
 * from a real mouse/touch drag; `zoomend` fires on any zoom level change,
 * gesture-driven or programmatic, which is broad enough to be a reasonable
 * trade rather than a gap — the one gesture this deliberately does NOT cover
 * is keyboard arrow-key panning (Leaflet pans it via `panBy`, which fires
 * `moveend` but not `dragend`); accepted as an edge case not worth chasing
 * for a personal, mouse/touch-first tool.
 *
 * `getCenter()` is wrapped before being handed off: Leaflet's map center is
 * NOT wrapped into [-180, 180] the way `ClickCapture` above wraps a click —
 * pan past the antimeridian and it keeps accumulating past ±180, which
 * `loadView` (rightly) rejects as out of range on the next load, silently
 * discarding the save (F2). `ClickCapture` already wraps for the same
 * reason; this mirrors it.
 *
 * This is unrelated to Section A's "fit on mount only" rule: that rule is
 * about what React/App state can do to the map (nothing, after mount, ever
 * moves it via a prop or a re-render) — Leaflet itself can still move the
 * map on its own (a resize, a popup's `autoPan`), which is exactly why this
 * listens for specific settled gestures rather than "the view changed for
 * any reason." Watching — even watching the wrong events, as `moveend` alone
 * did — can never itself move the map; it can only mis-record where it is.
 */
function ViewPersister({
  onViewChange,
}: {
  onViewChange: (view: PersistedView) => void;
}) {
  function report(map: L.Map) {
    const center = map.getCenter().wrap();
    onViewChange({ center: [center.lat, center.lng], zoom: map.getZoom() });
  }

  useMapEvents({
    dragend(e) {
      report(e.target);
    },
    zoomend(e) {
      report(e.target);
    },
  });
  return null;
}

export function MapView({
  initialView,
  pins,
  selectedPinId,
  onMapClick,
  onSelectPin,
  onViewChange,
}: {
  initialView: InitialView;
  pins: Pin[];
  selectedPinId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelectPin: (id: string) => void;
  onViewChange: (view: PersistedView) => void;
}) {
  // react-leaflet reads these props once, when it CREATES the Leaflet map (its
  // container ref callback has no dependencies), and ignores every later
  // change. That is what makes the fit a mount-time event by construction: no
  // save, no re-render and no state change can move the map afterwards, so an
  // edit in progress can never have the view yanked out from under it.
  //
  // Exactly one form is passed: given both, react-leaflet prefers center+zoom
  // and the fit would be silently dropped.
  const mountView: MapContainerProps =
    initialView.kind === 'bounds'
      ? {
          bounds: initialView.bounds,
          boundsOptions: {
            padding: [FIT_PADDING_PX, FIT_PADDING_PX],
            // Two leads a few metres apart would otherwise fit at the tile
            // layer's maximum zoom, which shows a roof and no context.
            maxZoom: CLOSE_UP_ZOOM,
          },
        }
      : { center: initialView.center, zoom: initialView.zoom };

  // `className` is deliberately constant. MapContainer freezes className/id/
  // style in a `useState` initialiser — the same read-once behaviour the fit
  // relies on above — so a class toggled after mount would never reach the DOM.
  // The armed cursor therefore lives on the wrapping `.map-pane` in App.
  return (
    <MapContainer {...mountView} className="map">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCapture onClick={onMapClick} />
      <ViewPersister onViewChange={onViewChange} />
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          position={[pin.lat, pin.lng]}
          icon={pinIcon(colorForStrength(pin.strength), pin.id === selectedPinId)}
          eventHandlers={{ click: () => onSelectPin(pin.id) }}
        >
          <Popup>
            <strong>{pin.name}</strong>
            <br />
            {STRENGTH_LABELS[pin.strength]} lead
            {/* pre-wrap so the notes read back with the line breaks they were
                written with; JSX escapes the text itself. */}
            {pin.notes ? (
              <span className="popup__notes">{pin.notes}</span>
            ) : (
              <span className="popup__notes popup__notes--empty">
                No notes yet — add them in the sidebar.
              </span>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
