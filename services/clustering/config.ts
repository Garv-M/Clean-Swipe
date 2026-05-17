export interface ClusteringConfiguration {
  splitTimeThreshold: number;
  distanceThresholdKm: number;
  mergeTimeThreshold: number;
  chainGapSeconds: number;
  locationThresholdKm: number;
  suburbRadiusKm: number;
  suburbPopulationRatio: number;
  metropolisThreshold: number;
  minClusterSize: number;
}

export const DEFAULT_CONFIG: ClusteringConfiguration = {
  splitTimeThreshold: 6 * 3600,
  distanceThresholdKm: 50,
  mergeTimeThreshold: 48 * 3600,
  chainGapSeconds: 24 * 3600,
  locationThresholdKm: 50,
  suburbRadiusKm: 30,
  suburbPopulationRatio: 3,
  metropolisThreshold: 100_000,
  minClusterSize: 3,
};
