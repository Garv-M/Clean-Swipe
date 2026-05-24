import type { Asset } from '@/types';
import type { ClusteringConfiguration } from '../config';
import type { GeocodedCluster } from './geocodePhase';

interface RescueResult {
  rescued: GeocodedCluster[];
  unrescued: Asset[];
}

export function rescuePhase(
  orphans: Asset[],
  assetCityMap: Map<string, string>,
  config: ClusteringConfiguration,
): RescueResult {
  const byCity = new Map<string, Asset[]>();
  const noCity: Asset[] = [];

  for (const orphan of orphans) {
    const city = assetCityMap.get(orphan.id);
    if (city) {
      const list = byCity.get(city) ?? [];
      list.push(orphan);
      byCity.set(city, list);
    } else {
      noCity.push(orphan);
    }
  }

  const rescued: GeocodedCluster[] = [];
  const unrescued: Asset[] = [...noCity];

  for (const [cityName, assets] of byCity) {
    if (assets.length >= config.minClusterSize) {
      rescued.push({ assets, locationName: cityName });
    } else {
      unrescued.push(...assets);
    }
  }

  return { rescued, unrescued };
}
