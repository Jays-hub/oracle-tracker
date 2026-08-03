import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colorForStrength, STRENGTH_LABELS } from '../domain/leadStrength';
import type { Pin } from '../domain/pin';

// A colored dot marker. `color` comes only from our fixed STRENGTH_COLORS map
// (never user input), so interpolating it into the icon HTML is safe.
function pinIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'pin-marker',
    html: `<span class="pin-marker__dot" style="background:${color}"></span>`,
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
  onMapClick,
}: {
  pins: Pin[];
  armed: boolean;
  onMapClick: (lat: number, lng: number) => void;
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
          icon={pinIcon(colorForStrength(pin.strength))}
        >
          <Popup>
            <strong>{pin.name}</strong>
            <br />
            {STRENGTH_LABELS[pin.strength]} lead
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
