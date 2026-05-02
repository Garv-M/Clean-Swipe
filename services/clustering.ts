import type { Asset, EventCluster } from '@/types';

const MAX_TIME_GAP_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_DISTANCE_KM = 50;
const MIN_CLUSTER_SIZE = 3;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function generateId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatDateRange(from: number, to: number): string {
  const s = new Date(from);
  const e = new Date(to);
  const month = s.toLocaleString('en', { month: 'long' });
  const year = s.getFullYear();
  if (s.toDateString() === e.toDateString()) {
    return `${month} ${s.getDate()}, ${year}`;
  }
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${month} ${s.getDate()}–${e.getDate()}, ${year}`;
  }
  const endMonth = e.toLocaleString('en', { month: 'long' });
  return `${month} ${s.getDate()} – ${endMonth} ${e.getDate()}, ${year}`;
}

function detectSource(group: Asset[]): string {
  const screenshots = group.filter((a) => a.filename.startsWith('Screenshot')).length;
  const whatsapp = group.filter((a) => a.filename.startsWith('WhatsApp')).length;
  if (screenshots / group.length > 0.7) return 'Screenshots';
  if (whatsapp / group.length > 0.7) return 'WhatsApp';
  return 'auto';
}

function averageLocation(group: Asset[]): { lat: number; lng: number } | undefined {
  const geoAssets = group.filter((a) => a.location != null);
  if (geoAssets.length === 0) return undefined;
  const lat = geoAssets.reduce((s, a) => s + a.location!.lat, 0) / geoAssets.length;
  const lng = geoAssets.reduce((s, a) => s + a.location!.lng, 0) / geoAssets.length;
  return { lat, lng };
}

export function clusterAssets(assets: Asset[]): EventCluster[] {
  if (assets.length === 0) return [];

  // Newest first
  const sorted = [...assets].sort((a, b) => b.createdAt - a.createdAt);

  const groups: Asset[][] = [];
  let current: Asset[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const asset = sorted[i];
    const prev = current[current.length - 1];
    // sorted descending — gap is always positive
    const timeGap = prev.createdAt - asset.createdAt;

    const anchorLoc = current[0].location;
    const assetLoc = asset.location;
    const tooFar =
      anchorLoc != null &&
      assetLoc != null &&
      haversineKm(anchorLoc.lat, anchorLoc.lng, assetLoc.lat, assetLoc.lng) > MAX_DISTANCE_KM;

    if (timeGap > MAX_TIME_GAP_MS || tooFar) {
      groups.push(current);
      current = [asset];
    } else {
      current.push(asset);
    }
  }
  groups.push(current);

  return groups
    .filter((g) => g.length >= MIN_CLUSTER_SIZE)
    .map((g) => {
      const timestamps = g.map((a) => a.createdAt);
      const from = Math.min(...timestamps);
      const to = Math.max(...timestamps);
      const source = detectSource(g);
      const label = source !== 'auto' ? source : 'Photos';

      return {
        id: generateId(),
        name: `${label} — ${formatDateRange(from, to)}`,
        dateRange: { from, to },
        assetCount: g.length,
        estimatedBytes: g.reduce((sum, a) => sum + (a.bytes ?? 3_000_000), 0),
        assetIds: g.map((a) => a.id),
        location: averageLocation(g),
        source: source === 'auto' ? undefined : source,
      } satisfies EventCluster;
    });
}
