// All angles in degrees on the public API; radians used internally.
const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

export interface ShopProperties {
  name: string;
  [key: string]: unknown;
}

export interface ShopGeometry {
  type: "Point";
  coordinates: [number, number]; // [lng, lat]
}

export interface ShopFeature {
  type: "Feature";
  geometry: ShopGeometry;
  properties: ShopProperties;
}

export interface NearestResult {
  feature: ShopFeature;
  distance: number;
  bearing: number;
}

// Great-circle distance in meters between two [lat, lng] points.
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Initial bearing (0=N, 90=E) from point 1 to point 2, in degrees [0,360).
export function bearingDegrees(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Brute-force nearest. features = GeoJSON features with [lng,lat] coords.
// Returns { feature, distance, bearing } or null.
export function findNearest(
  lat: number,
  lng: number,
  features: ShopFeature[]
): NearestResult | null {
  let best: NearestResult | null = null;
  for (const f of features) {
    const [flng, flat] = f.geometry.coordinates; // GeoJSON is [lng, lat]!
    const d = haversineMeters(lat, lng, flat, flng);
    if (!best || d < best.distance) {
      best = { feature: f, distance: d, bearing: bearingDegrees(lat, lng, flat, flng) };
    }
  }
  return best;
}

// Human-readable distance with the ~ prefix.
export function fmtDistance(m: number): string {
  if (m < 1000) return `~${Math.round(m)} m`;
  return `~ ${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
