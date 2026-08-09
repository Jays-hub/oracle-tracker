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

// A colored dot marker. Built only from a pin's strength (which fixes its
// color) and whether it's selected — a total of LEAD_STRENGTHS.length * 2
// distinct icons ever exist, so they're cached rather than rebuilt on every
// render of every marker.
const iconCache = new Map<string, L.DivIcon>();

function pinIcon(strength: Pin['strength'], selected: boolean): L.DivIcon {
  const key = `${strength}:${selected}`;
  const cached = iconCache.get(key);
  if (cached) return cached;

  const cls = `pin-marker__dot${selected ? ' pin-marker__dot--selected' : ''}`;
  const icon = L.divIcon({
    className: 'pin-marker',
    html: `<span class="${cls}" style="background:${colorForStrength(strength)}"></span>`,
    iconSize: [MARKER_SIZE_PX, MARKER_SIZE_PX],
    iconAnchor: [MARKER_SIZE_PX / 2, MARKER_SIZE_PX / 2],
    popupAnchor: [0, -12],
  });
  iconCache.set(key, icon);
  return icon;
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

export function MapView({
  initialView,
  pins,
  selectedPinId,
  onMapClick,
  onSelectPin,
}: {
  initialView: InitialView;
  pins: Pin[];
  selectedPinId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelectPin: (id: string) => void;
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
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          position={[pin.lat, pin.lng]}
          icon={pinIcon(pin.strength, pin.id === selectedPinId)}
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
