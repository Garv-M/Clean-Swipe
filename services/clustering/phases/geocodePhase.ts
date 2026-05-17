import type { Asset } from '@/types';
import type { ClusteringConfiguration } from '../config';
import type { GeoCity } from '../geoNamesService';
import type { RawCluster } from './splitPhase';

export type { GeoCity };

export interface GeocodeService {
  nearestCity(lat: number, lng: number): GeoCity | null;
  formatLocationName(city: GeoCity): string;
}

export interface GeocodedCluster extends RawCluster {
  locationName?: string;
}

interface GeocodeResult {
  clusters: GeocodedCluster[];
  assetCityMap: Map<string, string>;
}

function averageLocation(assets: Asset[]): { lat: number; lng: number } | null {
  const geo = assets.filter((a) => a.location != null && Number.isFinite(a.location.lat) && Number.isFinite(a.location.lng));
  if (geo.length === 0) return null;
  const lat = geo.reduce((s, a) => s + a.location!.lat, 0) / geo.length;
  const lng = geo.reduce((s, a) => s + a.location!.lng, 0) / geo.length;
  return { lat, lng };
}

function clusterEnd(c: RawCluster): number {
  return Math.max(...c.assets.map((a) => a.createdAt));
}

function clusterStart(c: RawCluster): number {
  return Math.min(...c.assets.map((a) => a.createdAt));
}

export function geocodePhase(
  clusters: RawCluster[],
  geo: GeocodeService,
  config: ClusteringConfiguration,
): GeocodeResult {
  const thresholdMs = config.mergeTimeThreshold * 1000;

  // Name every cluster
  // Loops through each cluster, computes GPS center, calls geo.nearestCity() → gets a city name.
  const geocoded: GeocodedCluster[] = clusters.map((c, idx) => {
    const loc = averageLocation(c.assets);
    let locationName: string | undefined;
    if (loc) {
      const city = geo.nearestCity(loc.lat, loc.lng);
      if (city) locationName = geo.formatLocationName(city);
    }
    if (__DEV__) {
      const from = new Date(Math.min(...c.assets.map((a) => a.createdAt))).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
      const to = new Date(Math.max(...c.assets.map((a) => a.createdAt))).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
      const gps = loc ? `(${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)})` : 'no GPS';
      console.log(`[geocode] cluster ${idx}: ${from} – ${to} | ${c.assets.length} assets | ${gps} → ${locationName ?? 'unnamed'}`);
    }
    return { ...c, locationName };
  });

  // merging non-adjacent clusters that have the same city name and are within 48 hours of each other.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < geocoded.length; i++) {
      if (!geocoded[i].locationName) continue;
      for (let j = i + 1; j < geocoded.length; j++) {
        if (geocoded[j].locationName !== geocoded[i].locationName) continue;

        const gap = clusterStart(geocoded[j]) - clusterEnd(geocoded[i]);
        if (gap > thresholdMs) continue;

        geocoded[i] = {
          assets: [...geocoded[i].assets, ...geocoded[j].assets],
          locationName: geocoded[i].locationName,
        };
        geocoded.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }

  // every individual asset that has GPS, calls geo.nearestCity() on that asset's own coordinates and stores the result
  const assetCityMap = new Map<string, string>();
  for (const cluster of geocoded) {
    for (const asset of cluster.assets) {
      if (asset.location && Number.isFinite(asset.location.lat) && Number.isFinite(asset.location.lng)) {
        const city = geo.nearestCity(asset.location.lat, asset.location.lng);
        if (city) assetCityMap.set(asset.id, geo.formatLocationName(city));
      }
    }
  }

  return { clusters: geocoded, assetCityMap };
}
