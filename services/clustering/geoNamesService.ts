import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import type { ClusteringConfiguration } from './config';
import { DEFAULT_CONFIG } from './config';
import { haversineKm } from './haversine';
import { KDTree } from './kdTree';

export interface GeoCity {
  name: string;
  lat: number;
  lng: number;
  countryCode: string;
  population: number;
}

interface GeoCityPoint extends GeoCity {}

let cachedTree: KDTree<GeoCityPoint> | null = null;
let cachedCities: GeoCityPoint[] | null = null;
const lookupCache = new Map<string, GeoCity | null>();

function quantizeKey(lat: number, lng: number): string {
  return `${Math.round(lat * 1000)},${Math.round(lng * 1000)}`;
}

function parseTsv(raw: string): GeoCityPoint[] {
  const lines = raw.split('\n');
  const cities: GeoCityPoint[] = [];
  cities.length = lines.length;
  let count = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;

    const t1 = line.indexOf('\t');
    const t2 = line.indexOf('\t', t1 + 1);
    const t3 = line.indexOf('\t', t2 + 1);
    const t4 = line.indexOf('\t', t3 + 1);

    if (t4 === -1) continue;

    const lat = +line.slice(t1 + 1, t2);
    const lng = +line.slice(t2 + 1, t3);
    const pop = +line.slice(t4 + 1);

    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

    cities[count++] = {
      name: line.slice(0, t1),
      lat,
      lng,
      countryCode: line.slice(t3 + 1, t4),
      population: Number.isNaN(pop) ? 0 : pop,
    };
  }

  cities.length = count;
  return cities;
}

export async function initGeoNames(): Promise<void> {
  if (cachedTree) return;

  const t0 = Date.now();
  if (__DEV__) console.log('[GeoNames] loading TSV asset...');

  const [asset] = await Asset.loadAsync(
    require('../../assets/data/geonames_cities.tsv'),
  );

  if (!asset.localUri) {
    throw new Error('GeoNames asset has no localUri after loading');
  }

  const t1 = Date.now();
  if (__DEV__) console.log(`[GeoNames] asset loaded in ${t1 - t0}ms, localUri=${asset.localUri}`);

  const raw = await new File(asset.localUri).text();
  const t2 = Date.now();
  if (__DEV__) console.log(`[GeoNames] file read in ${t2 - t1}ms (${(raw.length / 1024 / 1024).toFixed(1)}MB)`);

  cachedCities = parseTsv(raw);
  const t3 = Date.now();
  if (__DEV__) {
    console.log(`[GeoNames] parsed ${cachedCities.length} cities in ${t3 - t2}ms`);
    const samples = cachedCities.slice(0, 3).map((c) => `${c.name}(${c.countryCode}) ${c.lat},${c.lng} pop=${c.population}`);
    console.log(`[GeoNames] sample cities: ${samples.join(' | ')}`);
  }

  cachedTree = KDTree.build(cachedCities, (c) => [c.lat, c.lng]);
  const t4 = Date.now();
  if (__DEV__) console.log(`[GeoNames] KDTree built in ${t4 - t3}ms — total init: ${t4 - t0}ms`);

  lookupCache.clear();
}

export function isGeoNamesReady(): boolean {
  return cachedTree !== null;
}

let lookupCount = 0;

export function nearestCity(
  lat: number,
  lng: number,
  config: ClusteringConfiguration = DEFAULT_CONFIG,
): GeoCity | null {
  if (!cachedTree) return null;

  const key = quantizeKey(lat, lng);
  if (lookupCache.has(key)) return lookupCache.get(key)!;

  const candidates = cachedTree.nearestK([lat, lng], 100);
  if (candidates.length === 0) {
    lookupCache.set(key, null);
    return null;
  }

  const shouldLog = __DEV__ && lookupCount < 5;
  lookupCount++;

  if (shouldLog) {
    const top3 = candidates.slice(0, 3).map((c) => `${c.name}(${c.countryCode}) @ ${c.lat.toFixed(2)},${c.lng.toFixed(2)} dist=${haversineKm(lat, lng, c.lat, c.lng).toFixed(0)}km`);
    console.log(`[GeoNames] lookup(${lat.toFixed(4)}, ${lng.toFixed(4)}) top3: ${top3.join(' | ')}`);
  }

  const nearby = candidates.filter(
    (c) => haversineKm(lat, lng, c.lat, c.lng) <= config.suburbRadiusKm,
  );

  const countryVotes = new Map<string, { count: number; maxPop: number }>();
  for (const c of nearby.length > 0 ? nearby : [candidates[0]]) {
    const entry = countryVotes.get(c.countryCode) ?? { count: 0, maxPop: 0 };
    entry.count++;
    entry.maxPop = Math.max(entry.maxPop, c.population);
    countryVotes.set(c.countryCode, entry);
  }

  let detectedCountry = '';
  let bestCount = 0;
  let bestPop = 0;
  for (const [code, v] of countryVotes) {
    if (v.count > bestCount || (v.count === bestCount && v.maxPop > bestPop)) {
      detectedCountry = code;
      bestCount = v.count;
      bestPop = v.maxPop;
    }
  }

  const sameCountry = candidates.filter((c) => c.countryCode === detectedCountry);
  if (sameCountry.length === 0) {
    lookupCache.set(key, null);
    return null;
  }

  let nearest = sameCountry[0];
  let nearestDist = haversineKm(lat, lng, nearest.lat, nearest.lng);

  for (let i = 1; i < sameCountry.length; i++) {
    const d = haversineKm(lat, lng, sameCountry[i].lat, sameCountry[i].lng);
    if (d < nearestDist) {
      nearest = sameCountry[i];
      nearestDist = d;
    }
  }

  if (nearest.population < config.metropolisThreshold) {
    for (const c of sameCountry) {
      if (
        c.population >= config.metropolisThreshold &&
        c.population >= nearest.population * config.suburbPopulationRatio &&
        haversineKm(lat, lng, c.lat, c.lng) <= config.suburbRadiusKm
      ) {
        nearest = c;
        break;
      }
    }
  }

  const result: GeoCity = {
    name: nearest.name,
    lat: nearest.lat,
    lng: nearest.lng,
    countryCode: nearest.countryCode,
    population: nearest.population,
  };

  if (shouldLog) {
    console.log(`[GeoNames] → resolved: ${result.name}, ${result.countryCode} (pop=${result.population}, dist=${haversineKm(lat, lng, result.lat, result.lng).toFixed(0)}km, country=${detectedCountry})`);
  }

  lookupCache.set(key, result);
  return result;
}

export function formatLocationName(city: GeoCity): string {
  return `${city.name}, ${city.countryCode}`;
}

export function clearGeoNamesCache(): void {
  cachedTree = null;
  cachedCities = null;
  lookupCache.clear();
  lookupCount = 0;
}
