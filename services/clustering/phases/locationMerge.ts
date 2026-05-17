import type { Asset } from '@/types';
import type { ClusteringConfiguration } from '../config';
import { haversineKm } from '../haversine';
import type { RawCluster } from './splitPhase';

//Computes the GPS center of a cluster by averaging all assets that have coordinates.
function averageLocation(assets: Asset[]): { lat: number; lng: number } | null {
  const geo = assets.filter((a) => a.location != null && Number.isFinite(a.location.lat) && Number.isFinite(a.location.lng));
  if (geo.length === 0) return null;
  const lat = geo.reduce((s, a) => s + a.location!.lat, 0) / geo.length;
  const lng = geo.reduce((s, a) => s + a.location!.lng, 0) / geo.length;
  return { lat, lng };
}

// finds the latest and earliest createdAt timestamp in a cluster.
function clusterEnd(c: RawCluster): number {
  return Math.max(...c.assets.map((a) => a.createdAt));
}

function clusterStart(c: RawCluster): number {
  return Math.min(...c.assets.map((a) => a.createdAt));
}

// Purpose: After Phase 1 splits photos into clusters by time gaps, 
// you may have two adjacent clusters that are actually at the same location — e.g., 
// morning photos and afternoon photos in Delhi, split by a 7-hour gap. 
// This phase merges them back if they're close enough in both space and time.
export function locationMerge(
  clusters: RawCluster[],
  config: ClusteringConfiguration,
): RawCluster[] {
  if (clusters.length <= 1) return clusters;

  const thresholdMs = config.mergeTimeThreshold * 1000;
  const merged = [...clusters];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < merged.length - 1; i++) {
      const a = merged[i];
      const b = merged[i + 1];

      const locA = averageLocation(a.assets);
      const locB = averageLocation(b.assets);
      if (!locA || !locB) continue;

      const timeGap = clusterStart(b) - clusterEnd(a);
      if (timeGap > thresholdMs) continue;

      const dist = haversineKm(locA.lat, locA.lng, locB.lat, locB.lng);
      if (dist > config.distanceThresholdKm) continue;

      merged[i] = { assets: [...a.assets, ...b.assets] };
      merged.splice(i + 1, 1);
      changed = true;
      break;
    }
  }

  return merged;
}
