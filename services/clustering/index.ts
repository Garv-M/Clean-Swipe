import type { Asset, EventCluster } from '@/types';
import { DEFAULT_CONFIG, type ClusteringConfiguration } from './config';
import {
    clearGeoNamesCache,
    formatLocationName,
    initGeoNames,
    isGeoNamesReady,
    nearestCity,
} from './geoNamesService';
import { runPipeline, type ProgressCallback } from './pipeline';

export { clearGeoNamesCache, initGeoNames };
export type { ClusteringConfiguration, ProgressCallback };

export async function clusterAssets(
  assets: Asset[],
  options?: {
    config?: Partial<ClusteringConfiguration>;
    onProgress?: ProgressCallback;
  },
): Promise<EventCluster[]> {
  const config = { ...DEFAULT_CONFIG, ...options?.config };

  if (!isGeoNamesReady()) {
    try {
      await initGeoNames();
      if (__DEV__) console.log('[clustering] GeoNames loaded successfully');
    } catch (err) {
      if (__DEV__) console.warn('[clustering] GeoNames init failed, using time-only clustering', err);
    }
  }

  const geo = {
    nearestCity: (lat: number, lng: number) => nearestCity(lat, lng, config),
    formatLocationName,
  };

  return runPipeline(assets, geo, config, options?.onProgress);
}
