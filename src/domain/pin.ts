import { isLeadStrength, type LeadStrength } from './leadStrength';

/** A restaurant lead placed on the map. */
export interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  strength: LeadStrength;
}

export class InvalidPinError extends Error {
  constructor(message: string) {
    super(`Invalid pin: ${message}`);
    this.name = 'InvalidPinError';
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate an untrusted value (e.g. a JSON-parsed record from storage) into a
 * Pin, or throw InvalidPinError. This is the boundary that keeps corrupt data
 * from ever becoming a live pin.
 */
export function parsePin(raw: unknown): Pin {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidPinError('not an object');
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) {
    throw new InvalidPinError('id must be a non-empty string');
  }
  if (typeof r.name !== 'string') {
    throw new InvalidPinError('name must be a string');
  }
  if (!isFiniteNumber(r.lat) || r.lat < -90 || r.lat > 90) {
    throw new InvalidPinError('lat must be a finite number in [-90, 90]');
  }
  if (!isFiniteNumber(r.lng) || r.lng < -180 || r.lng > 180) {
    throw new InvalidPinError('lng must be a finite number in [-180, 180]');
  }
  if (!isLeadStrength(r.strength)) {
    throw new InvalidPinError(
      `strength must be one of strong|weak|failed, got ${JSON.stringify(r.strength)}`,
    );
  }

  return { id: r.id, name: r.name, lat: r.lat, lng: r.lng, strength: r.strength };
}

/** Create a new, validated pin from user input. Trims and requires a name. */
export function createPin(input: {
  name: string;
  lat: number;
  lng: number;
  strength: LeadStrength;
}): Pin {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InvalidPinError('name must not be empty');
  }
  return parsePin({
    id: newId(),
    name,
    lat: input.lat,
    lng: input.lng,
    strength: input.strength,
  });
}

let fallbackCounter = 0;
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `pin-${Date.now()}-${fallbackCounter}`;
}
