import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colorForStrength, STRENGTH_LABELS } from '../domain/leadStrength';
import type { Pin } from '../domain/pin';

// A colored dot marker. `color` comes only from our fixed STRENGTH_COLORS map
// and `selected` is a boolean, so nothing user-authored reaches the icon HTML.
function pinIcon(color: string, selected: boolean): L.DivIcon {
  const cls = `pin-marker__dot${selected ? ' pin-marker__dot--selected' : ''}`;
  return L.divIcon({
    className: 'pin-marker',
    html: `<span class="${cls}" style="background:${color}"></span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
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

export function MapView({
  pins,
  armed,
  selectedPinId,
  onMapClick,
  onSelectPin,
}: {
  pins: Pin[];
  armed: boolean;
  selectedPinId: string | null;
  onMapClick: (lat: number, lng: number) => void;
  onSelectPin: (id: string) => void;
}) {
  return (
    <MapContainer
      center={[40.7128, -74.006]}
      zoom={12}
      className={`map${armed ? ' map--armed' : ''}`}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickCapture onClick={onMapClick} />
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
