import type { Asset } from '@/types';
import type { ClusteringConfiguration } from '../config';
import { haversineKm } from '../haversine';
import type { GeocodedCluster } from './geocodePhase';

function clusterEnd(c: GeocodedCluster): number {
  return Math.max(...c.assets.map((a) => a.createdAt));
}

function clusterStart(c: GeocodedCluster): number {
  return Math.min(...c.assets.map((a) => a.createdAt));
}

function clusterCenter(c: GeocodedCluster): { lat: number; lng: number } | null {
  const geo = c.assets.filter((a) => a.location != null && Number.isFinite(a.location!.lat) && Number.isFinite(a.location!.lng));
  if (geo.length === 0) return null;
  const lat = geo.reduce((s, a) => s + a.location!.lat, 0) / geo.length;
  const lng = geo.reduce((s, a) => s + a.location!.lng, 0) / geo.length;
  return { lat, lng };
}

interface ChainResult {
  clusters: GeocodedCluster[];
  remainingOrphans: Asset[];
}

export function chainExpansion(
  clusters: GeocodedCluster[],
  orphans: Asset[],
  _assetCityMap: Map<string, string>,
  config: ClusteringConfiguration,
): ChainResult {
  const chainGapMs = config.chainGapSeconds * 1000;
  const absorbed = new Set<string>();
  const expanded = clusters.map((c) => ({ ...c, assets: [...c.assets] }));

  for (const orphan of orphans) {
    let bestCluster: GeocodedCluster | null = null;
    let bestGap = Infinity;

    for (const cluster of expanded) {
      const start = clusterStart(cluster);
      const end = clusterEnd(cluster);

      let timeGap: number;
      if (orphan.createdAt < start) {
        timeGap = start - orphan.createdAt;
      } else if (orphan.createdAt > end) {
        timeGap = orphan.createdAt - end;
      } else {
        timeGap = 0;
      }

      if (timeGap > chainGapMs) continue;

      if (orphan.location && Number.isFinite(orphan.location.lat) && Number.isFinite(orphan.location.lng)) {
        const center = clusterCenter(cluster);
        if (
          center &&
          haversineKm(orphan.location.lat, orphan.location.lng, center.lat, center.lng) >
            config.locationThresholdKm
        ) {
          continue;
        }
      }

      if (timeGap < bestGap) {
        bestGap = timeGap;
        bestCluster = cluster;
      }
    }

    if (bestCluster) {
      bestCluster.assets.push(orphan);
      absorbed.add(orphan.id);
    }
  }

  return {
    clusters: expanded,
    remainingOrphans: orphans.filter((o) => !absorbed.has(o.id)),
  };
}
