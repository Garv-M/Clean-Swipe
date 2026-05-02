/**
 * types/index.ts
 *
 * Central type definitions for Clean Swipe.
 * All other modules import from here — no logic, no side effects.
 *
 * NOTE: Decision uses a regular string enum (not const enum) because
 * babel-preset-expo transpiles files individually. const enum requires
 * cross-file type information that Babel cannot provide, which causes
 * runtime "cannot read property of undefined" errors.
 */

// ---------------------------------------------------------------------------
// GeoPoint
// ---------------------------------------------------------------------------

/** A WGS-84 latitude/longitude coordinate pair. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------
// Asset
// ---------------------------------------------------------------------------

/** A photo or video entry from the device media library. */
export interface Asset {
  /** Unique identifier from expo-media-library (or a stable hash). */
  id: string;

  /** Local file URI or remote URL (cloud-only assets may have a proxy URI). */
  uri: string;

  /** Original filename as stored on disk, e.g. "IMG_4821.HEIC". */
  filename: string;

  /** Media type discriminator. */
  kind: 'photo' | 'video';

  /** Native pixel dimensions. */
  dimensions: {
    width: number;
    height: number;
  };

  /** File size in bytes. Undefined means the value has not yet been fetched. */
  bytes?: number;

  /** Creation timestamp in Unix milliseconds. */
  createdAt: number;

  /** GPS coordinates embedded in EXIF, if available. */
  location?: GeoPoint;

  /** Album names this asset belongs to (may be empty). */
  albums: string[];

  /** Whether the user has marked this asset as a device favorite. */
  favorite: boolean;

  /** Whether the asset is in the device's Hidden album. */
  hidden: boolean;

  /**
   * True when the asset exists only in iCloud / Google Photos and has not
   * been downloaded to the device. Swiping on these requires a download step.
   */
  cloudOnly: boolean;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * The action the user took (or the app inferred) for a single asset.
 * String enum so that stored values are human-readable in MMKV/JSON.
 */
export enum Decision {
  KEEP = 'KEEP',
  DELETE_STAGED = 'DELETE_STAGED',
  FAVORITE = 'FAVORITE',
  SKIP_LATER = 'SKIP_LATER',
}

// ---------------------------------------------------------------------------
// DecisionRecord
// ---------------------------------------------------------------------------

/** Immutable log entry created whenever a Decision is applied to an Asset. */
export interface DecisionRecord {
  /** The asset this decision applies to. */
  assetId: string;

  /** The action taken. */
  decision: Decision;

  /** Wall-clock time the decision was recorded, in Unix milliseconds. */
  timestamp: number;

  /** The Session that produced this record. */
  sessionId: string;

  /**
   * Set to true when the swipe velocity was unusually high, indicating the
   * user may have acted too quickly. Used to surface a "Review fast decisions"
   * nudge at session end.
   */
  isSuspicious?: boolean;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * A single review session — a bounded queue of assets the user works through.
 * Sessions are persisted to MMKV so they survive app restarts.
 */
export interface Session {
  /** UUID v4, generated at session creation time. */
  id: string;

  /** Optional user-facing label, e.g. "Weekend clean-up". */
  name?: string;

  /** If this session was created from an EventCluster, its ID. */
  clusterId?: string;

  /** When the session record was first created, in Unix milliseconds. */
  createdAt: number;

  /** When the user first swiped (i.e. the session moved from pending → active). */
  startedSwipingAt?: number;

  /** When all assets in queueIds received a Decision. */
  completedAt?: number;

  /**
   * Ordered list of asset IDs to review.
   * The order determines swipe stack rendering.
   */
  queueIds: string[];

  /** Live set of current effective decisions for this session. Entries are removed when the user undoes a decision. */
  decisions: DecisionRecord[];

  /**
   * Sliding window of decisions eligible for undo, capped at 20 entries.
   * The last element is the most-recent decision that can be reversed.
   * Entries here are also present in decisions; undoing removes from both.
   */
  undoStack: DecisionRecord[];

  /**
   * Running estimate of bytes that will be freed if all DELETE_STAGED
   * decisions in this session are committed.
   */
  freedBytesEstimated: number;

  /**
   * Index of the next asset in queueIds to be shown to the user.
   * cursor === 0 means no assets have been reviewed yet.
   * cursor === queueIds.length means the session is fully reviewed.
   * Undefined is equivalent to 0 (session has not started).
   */
  cursor?: number;
}

// ---------------------------------------------------------------------------
// EventCluster
// ---------------------------------------------------------------------------

/**
 * A smart group of assets that the clustering algorithm determined belong to
 * the same trip, event, or content source.
 */
export interface EventCluster {
  /** UUID v4, stable across app restarts. */
  id: string;

  /**
   * Human-readable label computed by the clustering service.
   * Example: "Rajasthan Trip — Jan 12–18"
   */
  name: string;

  /** Temporal span of the assets in this cluster, in Unix milliseconds. */
  dateRange: {
    from: number;
    to: number;
  };

  /** Total number of assets (photos and videos) in this cluster. */
  assetCount: number;

  /** Sum of bytes across all assets (used for storage-savings preview). */
  estimatedBytes: number;

  /** IDs of every Asset belonging to this cluster. */
  assetIds: string[];

  /**
   * Approximate geographic centre of the cluster, derived by averaging
   * per-asset GPS coordinates.
   */
  location?: GeoPoint;

  /**
   * Content origin hint surfaced to the user.
   * Examples: 'WhatsApp', 'Screenshots', 'Camera', 'Instagram'
   */
  source?: string;
}
