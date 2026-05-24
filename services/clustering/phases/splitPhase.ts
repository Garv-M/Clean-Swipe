import type { Asset } from '@/types';
import type { ClusteringConfiguration } from '../config';
import { haversineKm } from '../haversine';

export interface RawCluster {
  assets: Asset[];
}

export function splitPhase(
  assets: Asset[],
  config: ClusteringConfiguration,
): RawCluster[] {
  if (assets.length === 0) return [];

  const sorted = [...assets].sort((a, b) => a.createdAt - b.createdAt);
  const thresholdMs = config.splitTimeThreshold * 1000;

  const clusters: RawCluster[] = [];
  let current: Asset[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const asset = sorted[i];
    const prev = current[current.length - 1];
    const timeGap = asset.createdAt - prev.createdAt;

    const anchorLoc = current[0].location;
    const assetLoc = asset.location;
    const anchorValid = anchorLoc != null && Number.isFinite(anchorLoc.lat) && Number.isFinite(anchorLoc.lng);
    const assetValid = assetLoc != null && Number.isFinite(assetLoc.lat) && Number.isFinite(assetLoc.lng);
    const tooFar =
      anchorValid &&
      assetValid &&
      haversineKm(anchorLoc!.lat, anchorLoc!.lng, assetLoc!.lat, assetLoc!.lng) >
        config.distanceThresholdKm;

    if (timeGap > thresholdMs || tooFar) {
      clusters.push({ assets: current });
      current = [asset];
    } else {
      current.push(asset);
    }
  }

  clusters.push({ assets: current });
  return clusters;
}
