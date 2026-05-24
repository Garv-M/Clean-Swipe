import type { Asset, EventCluster } from '@/types';
import type { ClusteringConfiguration } from './config';
import { chainExpansion } from './phases/chainExpansion';
import type { GeocodeService, GeocodedCluster } from './phases/geocodePhase';
import { geocodePhase } from './phases/geocodePhase';
import { locationMerge } from './phases/locationMerge';
import { rescuePhase } from './phases/rescuePhase';
import { splitPhase } from './phases/splitPhase';

export type ProgressCallback = (phase: string, percent: number) => void;

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDateRange(from: number, to: number): string {
  const s = new Date(from);
  const e = new Date(to);
  const startMonth = s.toLocaleString('en', { month: 'long' });
  const startYear = s.getFullYear();
  if (s.toDateString() === e.toDateString()) {
    return `${startMonth} ${s.getDate()}, ${startYear}`;
  }
  const endMonth = e.toLocaleString('en', { month: 'long' });
  const endYear = e.getFullYear();
  if (s.getMonth() === e.getMonth() && startYear === endYear) {
    return `${startMonth} ${s.getDate()}–${e.getDate()}, ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${s.getDate()} – ${endMonth} ${e.getDate()}, ${startYear}`;
  }
  return `${startMonth} ${s.getDate()}, ${startYear} – ${endMonth} ${e.getDate()}, ${endYear}`;
}

function averageLocation(assets: Asset[]): { lat: number; lng: number } | undefined {
  const geo = assets.filter((a) => a.location != null && Number.isFinite(a.location.lat) && Number.isFinite(a.location.lng));
  if (geo.length === 0) return undefined;
  const lat = geo.reduce((s, a) => s + a.location!.lat, 0) / geo.length;
  const lng = geo.reduce((s, a) => s + a.location!.lng, 0) / geo.length;
  return { lat, lng };
}

function toEventCluster(cluster: GeocodedCluster): EventCluster {
  const from = Math.min(...cluster.assets.map((a) => a.createdAt));
  const to = Math.max(...cluster.assets.map((a) => a.createdAt));
  const dateLabel = formatDateRange(from, to);
  const name = cluster.locationName
    ? `${cluster.locationName} — ${dateLabel}`
    : dateLabel;

  return {
    id: generateId(),
    name,
    dateRange: { from, to },
    assetCount: cluster.assets.length,
    estimatedBytes: cluster.assets.reduce((sum, a) => sum + (a.bytes ?? 3_000_000), 0),
    assetIds: cluster.assets.map((a) => a.id),
    location: averageLocation(cluster.assets),
    locationName: cluster.locationName,
  };
}

export function runPipeline(
  assets: Asset[],
  geo: GeocodeService,
  config: ClusteringConfiguration,
  onProgress?: ProgressCallback,
): EventCluster[] {
  if (assets.length === 0) return [];

  const t0 = Date.now();

  // clusters (cut on 6h time gaps or 50km distance)
  onProgress?.('Splitting by time and distance', 0.1);
  const rawClusters = splitPhase(assets, config);
  const t1 = Date.now();

  // clusters (adjacent clusters at same location within 48h merged)
  onProgress?.('Merging nearby clusters', 0.25);
  const merged = locationMerge(rawClusters, config);
  const t2 = Date.now();

  // same-city clusters within 48h merged, clusters named by nearest city, and every GPS-tagged asset mapped to nearest city
  onProgress?.('Geocoding clusters', 0.4);
  const { clusters: geocoded, assetCityMap } = geocodePhase(merged, geo, config);
  const t3 = Date.now();

  if (__DEV__) {
    const named = geocoded.filter((c) => c.locationName).length;
    const withGPS = assets.filter((a) => a.location != null).length;
    console.log(`[pipeline] input: ${assets.length} assets (${withGPS} with GPS)`);
    console.log(`[pipeline] split: ${rawClusters.length} clusters (${t1 - t0}ms)`);
    console.log(`[pipeline] merge: ${rawClusters.length} → ${merged.length} clusters (${t2 - t1}ms)`);
    console.log(`[pipeline] geocode: ${named}/${geocoded.length} clusters named, ${assetCityMap.size} assets city-mapped (${t3 - t2}ms)`);
  }

  // finds assets that ended up in no cluster at all
  const clusteredIds = new Set<string>();
  for (const c of geocoded) {
    for (const a of c.assets) clusteredIds.add(a.id);
  }
  const orphans = assets.filter((a) => !clusteredIds.has(a.id));

  onProgress?.('Absorbing nearby photos', 0.6);
  const { clusters: expanded, remainingOrphans } = chainExpansion(
    geocoded,
    orphans,
    assetCityMap,
    config,
  );
  const t4 = Date.now();

  onProgress?.('Rescuing remaining photos', 0.8);
  const { rescued } = rescuePhase(remainingOrphans, assetCityMap, config);
  const t5 = Date.now();

  const allClusters = [...expanded, ...rescued];
  const filtered = allClusters.filter((c) => c.assets.length >= config.minClusterSize);

  if (__DEV__) {
    console.log(`[pipeline] chain: absorbed ${orphans.length - remainingOrphans.length}/${orphans.length} orphans (${t4 - t3}ms)`);
    console.log(`[pipeline] rescue: ${rescued.length} clusters rescued, ${remainingOrphans.length} still orphaned (${t5 - t4}ms)`);
    console.log(`[pipeline] result: ${filtered.length} clusters (${allClusters.length - filtered.length} filtered < minSize=${config.minClusterSize})`);
    const namedFinal = filtered.filter((c) => c.locationName).length;
    console.log(`[pipeline] names: ${namedFinal}/${filtered.length} have location names`);
    console.log(`[pipeline] total pipeline time: ${t5 - t0}ms`);
  }

  onProgress?.('Done', 1.0);
  return filtered.map(toEventCluster);
}
