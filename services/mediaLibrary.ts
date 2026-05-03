/**
 * services/mediaLibrary.ts
 *
 * Thin, typed wrapper over expo-media-library.
 * Pure service module — no React, no hooks, no Zustand.
 *
 * All functions are standalone async functions; no class, no singleton.
 *
 * Platform notes:
 * - expo-media-library's base Asset type omits several runtime fields
 *   (fileSize, isFavorite, isHidden). We augment the type locally via
 *   RuntimeAsset / RuntimeAssetInfo rather than patching the library.
 * - isFavorite and isHidden are iOS-only. Optional chaining + nullish
 *   coalescing ensures safe defaults on Android.
 * - cloudOnly detection uses a URI heuristic: ph:// URIs are PhotoKit
 *   proxy URIs on iOS; a zero/absent fileSize confirms the asset has not
 *   been downloaded from iCloud.
 * - creationTime from expo-media-library v18 is normalised to Unix
 *   milliseconds on both iOS and Android.
 */

import type { Asset } from '@/types';
import * as MediaLibrary from 'expo-media-library';

// ---------------------------------------------------------------------------
// Runtime-only field augmentation
// ---------------------------------------------------------------------------

/**
 * expo-media-library's Asset type omits fields that exist at runtime but
 * are not yet reflected in the published .d.ts (fileSize, isFavorite on
 * the base Asset, isHidden on both Asset and AssetInfo).
 *
 * We cast to these augmented types internally so we avoid `as any` call-sites
 * scattered through the module.
 */
type RuntimeAsset = MediaLibrary.Asset & {
  /** File size in bytes. Present at runtime; absent from the declared type. */
  fileSize?: number;
  /**
   * Whether the asset is marked as a device favourite.
   * Declared on AssetInfo but also present on the base Asset at runtime.
   * @platform ios
   */
  isFavorite?: boolean;
  /**
   * Whether the asset lives in the device's Hidden album.
   * iOS-only; not present on Android — always undefined there.
   * @platform ios
   */
  isHidden?: boolean;
};

type RuntimeAssetInfo = MediaLibrary.AssetInfo & {
  /** File size in bytes. Present at runtime; absent from the declared type. */
  fileSize?: number;
  /**
   * Whether the asset lives in the device's Hidden album.
   * @platform ios
   */
  isHidden?: boolean;
};

// ---------------------------------------------------------------------------
// Internal mapping helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether an asset exists only in the cloud and has no local copy.
 *
 * Heuristic: iOS cloud-only assets use the ph:// proxy URI scheme and have a
 * zero or absent fileSize when not downloaded from iCloud.
 */
function isCloudOnly(uri: string, fileSize: number | undefined): boolean {
  return uri.startsWith('ph://') && (fileSize === 0 || fileSize == null);
}

/**
 * Map expo-media-library's mediaType to our Asset.kind discriminator.
 * pairedVideo is an iOS Live Photo companion clip — treated as video.
 */
function toKind(mediaType: MediaLibrary.MediaTypeValue): 'photo' | 'video' {
  return mediaType === 'video' || mediaType === 'pairedVideo' ? 'video' : 'photo';
}

/**
 * Map a MediaLibrary.Asset (returned by getAssetsAsync) to our Asset type.
 *
 * GPS location is not available from the paginated query — the library
 * would need a separate getAssetInfoAsync call per asset (N+1). Location
 * is therefore always undefined here; use getAssetInfo() when GPS is needed.
 *
 * albums is always [] for the same reason: album membership requires N+1
 * getAlbumsAsync calls per asset.
 */
function mapPageAsset(raw: RuntimeAsset): Asset {
  return {
    id: raw.id,
    uri: raw.uri,
    filename: raw.filename,
    kind: toKind(raw.mediaType),
    dimensions: { width: raw.width, height: raw.height },
    bytes: raw.fileSize ?? undefined,
    createdAt: raw.creationTime,
    location: undefined,
    albums: [],
    favorite: raw.isFavorite ?? false,
    hidden: raw.isHidden ?? false,
    cloudOnly: isCloudOnly(raw.uri, raw.fileSize),
  };
}

/**
 * Map a MediaLibrary.AssetInfo (returned by getAssetInfoAsync) to our Asset
 * type, including GPS coordinates when the EXIF data contains them.
 */
function mapAssetInfo(raw: RuntimeAssetInfo): Asset {
  const location =
    raw.location != null
      ? { lat: raw.location.latitude, lng: raw.location.longitude }
      : undefined;

  return {
    id: raw.id,
    uri: raw.uri,
    filename: raw.filename,
    kind: toKind(raw.mediaType),
    dimensions: { width: raw.width, height: raw.height },
    bytes: raw.fileSize ?? undefined,
    createdAt: raw.creationTime,
    location,
    albums: [],
    favorite: raw.isFavorite ?? false,
    hidden: raw.isHidden ?? false,
    cloudOnly: isCloudOnly(raw.uri, raw.fileSize),
  };
}

/**
 * Translate our mediaType option to the expo-media-library MediaTypeValue(s).
 *
 * 'all' maps to ['photo', 'video'] — audio and unknown are explicitly excluded
 * to keep results coherent for a photo-management app.
 */
function resolveMediaType(
  type: 'photo' | 'video' | 'all',
): MediaLibrary.MediaTypeValue | MediaLibrary.MediaTypeValue[] {
  switch (type) {
    case 'photo':
      return 'photo';
    case 'video':
      return 'video';
    case 'all':
      return ['photo', 'video'];
  }
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

/**
 * Request media library permissions from the OS.
 *
 * Returns true only when the user grants full (non-limited) access:
 *   - iOS: "Allow Access to All Photos" (accessPrivileges === 'all')
 *   - Android: MEDIA_IMAGES + MEDIA_VIDEO granted
 *   - iOS limited selection ("Select Photos...") returns false
 *
 * The caller should redirect the user to Settings on false to explain why
 * full access is required.
 */
export async function requestPermissions(): Promise<boolean> {
  const response = await MediaLibrary.requestPermissionsAsync();
  // accessPrivileges is 'all' | 'limited' | 'none' on iOS 14+;
  // on earlier iOS and Android it may be undefined when fully granted.
  return (
    response.status === 'granted' &&
      (response.accessPrivileges == null || response.accessPrivileges === 'all')
  );
}

/**
 * Return the current media library permission status without prompting.
 *
 * 'limited' takes priority over 'granted' because on iOS a limited selection
 * is technically "granted" by the OS but the app cannot see the full library.
 */
export async function getPermissionStatus(): Promise<
  'granted' | 'limited' | 'denied' | 'undetermined'
> {
  const response = await MediaLibrary.getPermissionsAsync();

  if (response.accessPrivileges === 'limited') {
    return 'limited';
  }
  if (response.status === 'granted') {
    return 'granted';
  }
  if (response.status === 'denied') {
    return 'denied';
  }
  return 'undetermined';
}

// ---------------------------------------------------------------------------
// Paginated asset fetching
// ---------------------------------------------------------------------------

/** Result shape for a single page of media assets. */
export interface FetchPageResult {
  assets: Asset[];
  /**
   * Whether the library has more assets beyond this page.
   * Pass endCursor as options.after to fetch the next page.
   */
  hasNextPage: boolean;
  /**
   * Opaque pagination cursor. Undefined when there are no further pages
   * or the page is empty. Pass as options.after on the next call.
   */
  endCursor: string | undefined;
}

/**
 * Fetch a paginated page of media assets from the device library, sorted by
 * creation time descending (newest first).
 *
 * @param options.after        endCursor returned by the previous fetchAssetsPage call
 * @param options.first        number of assets to fetch per page (default 50)
 * @param options.mediaType    filter by media type (default 'all' → photo + video)
 * @param options.skipCloudOnly  when true, cloud-only assets are removed from results
 */
export async function fetchAssetsPage(options?: {
  after?: string;
  first?: number;
  mediaType?: 'photo' | 'video' | 'all';
  skipCloudOnly?: boolean;
}): Promise<FetchPageResult> {
  const first = options?.first ?? 50;
  const mediaType = resolveMediaType(options?.mediaType ?? 'all');

  // SortByValue is `[SortByKey, boolean] | SortByKey`.
  // We provide an explicit tuple cast so TypeScript does not widen the literal
  // 'creationTime' to string or the pair to (string | boolean)[].
  const sortBy: [MediaLibrary.SortByKey, boolean][] = [['creationTime', false]];

  const result = await MediaLibrary.getAssetsAsync({
    first,
    after: options?.after,
    mediaType,
    sortBy,
  });

  let assets = result.assets.map((a) => mapPageAsset(a as RuntimeAsset));

  if (options?.skipCloudOnly) {
    assets = assets.filter((a) => !a.cloudOnly);
  }

  return {
    assets,
    hasNextPage: result.hasNextPage,
    // expo-media-library returns '' when there are no more pages; normalise to undefined.
    endCursor: result.endCursor || undefined,
  };
}

// ---------------------------------------------------------------------------
// Screenshot count (album-based, works on iOS + Android)
// ---------------------------------------------------------------------------

/**
 * Return the number of screenshots in the device library.
 *
 * On iOS "Screenshots" is a smart album — getAlbumAsync cannot find it.
 * We must use getAlbumsAsync with includeSmartAlbums to locate it.
 */
export async function getScreenshotCount(): Promise<number> {
  try {
    const albums = await MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true });
    const ssAlbum = albums.find(
      (a) => a.title.toLowerCase() === 'screenshots'
    );
    if (!ssAlbum) return 0;
    return ssAlbum.assetCount ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Single asset info with GPS
// ---------------------------------------------------------------------------

/**
 * Fetch full metadata for a single asset, including GPS coordinates embedded
 * in EXIF and whether the asset is currently stored only on the network.
 *
 * shouldDownloadFromNetwork is set to false to avoid triggering an iCloud
 * download as a side-effect of reading metadata.
 *
 * Returns null if the asset does not exist or the OS call fails.
 */
export async function getAssetInfo(assetId: string): Promise<Asset | null> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(assetId, {
      shouldDownloadFromNetwork: false,
    });
    return mapAssetInfo(info as RuntimeAssetInfo);
  } catch (err) {
    if (__DEV__) console.warn('[getAssetInfo]', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Batch deletion
// ---------------------------------------------------------------------------

/** Result of a batch delete operation, split by success and failure. */
export interface DeletionResult {
  /** Asset IDs that were successfully removed from the library. */
  deleted: string[];
  /** Asset IDs that could not be deleted (permission denied, not found, OS error). */
  failed: string[];
}

/**
 * Maximum assets per OS deleteAssetsAsync call.
 * Kept at 100 to avoid hitting system limits on large deletions.
 */
const DELETION_BATCH_SIZE = 100;

/**
 * Delete assets from the device media library.
 *
 * Processing happens in batches of DELETION_BATCH_SIZE (100) to avoid OS
 * limits. On iOS this moves assets to the system's Recently Deleted album
 * rather than permanently destroying them immediately.
 *
 * A batch is marked as failed when:
 *   - The OS call rejects (throws) — e.g. the app lacks write permission
 *   - The OS call resolves to false — permission denied at the album level
 *
 * Individual asset granularity is not available from the OS API; if a batch
 * partially fails, the entire batch is conservatively marked as failed.
 */
export async function deleteAssets(assetIds: string[]): Promise<DeletionResult> {
  const deleted: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < assetIds.length; i += DELETION_BATCH_SIZE) {
    const batch = assetIds.slice(i, i + DELETION_BATCH_SIZE);
    try {
      const success = await MediaLibrary.deleteAssetsAsync(batch);
      if (success) {
        deleted.push(...batch);
      } else {
        // OS returned false — likely permission denied at the album level.
        failed.push(...batch);
      }
    } catch {
      // OS threw — surface as failures without crashing the overall operation.
      failed.push(...batch);
    }
  }

  return { deleted, failed };
}
