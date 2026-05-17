type Coords = [number, number];
type CoordExtractor<T> = (point: T) => Coords;

interface KDNode<T> {
  point: T;
  coords: Coords;
  left: KDNode<T> | null;
  right: KDNode<T> | null;
  splitDim: number;
}

function squaredEuclidean(a: Coords, b: Coords): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function buildNode<T>(
  points: { point: T; coords: Coords }[],
  depth: number,
): KDNode<T> | null {
  if (points.length === 0) return null;

  const dim = depth % 2;
  const mid = points.length >> 1;
  points.sort((a, b) => a.coords[dim] - b.coords[dim]);

  return {
    point: points[mid].point,
    coords: points[mid].coords,
    splitDim: dim,
    left: buildNode(points.slice(0, mid), depth + 1),
    right: buildNode(points.slice(mid + 1), depth + 1),
  };
}

export class KDTree<T> {
  private root: KDNode<T> | null;
  readonly size: number;

  private constructor(root: KDNode<T> | null, size: number) {
    this.root = root;
    this.size = size;
  }

  static build<T>(points: T[], extractCoords: CoordExtractor<T>): KDTree<T> {
    const mapped = points.map((p) => ({ point: p, coords: extractCoords(p) }));
    const root = buildNode(mapped, 0);
    return new KDTree(root, points.length);
  }

  nearestK(query: Coords, k: number): T[] {
    if (!this.root || k <= 0) return [];

    const heap: { point: T; dist: number }[] = [];

    const search = (node: KDNode<T> | null) => {
      if (!node) return;

      const dist = squaredEuclidean(query, node.coords);

      if (heap.length < k) {
        heap.push({ point: node.point, dist });
        heap.sort((a, b) => b.dist - a.dist);
      } else if (dist < heap[0].dist) {
        heap[0] = { point: node.point, dist };
        heap.sort((a, b) => b.dist - a.dist);
      }

      const diff = query[node.splitDim] - node.coords[node.splitDim];
      const close = diff < 0 ? node.left : node.right;
      const far = diff < 0 ? node.right : node.left;

      search(close);

      if (heap.length < k || diff * diff < heap[0].dist) {
        search(far);
      }
    };

    search(this.root);
    return heap.sort((a, b) => a.dist - b.dist).map((h) => h.point);
  }
}
