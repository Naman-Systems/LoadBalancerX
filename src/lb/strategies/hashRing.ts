import crypto from "node:crypto";

interface RingPoint {
  hash: number;
  backendId: string;
}

function hashKey(key: string): number {
  // md5 is used purely for even distribution here, not security. We read
  // the first 4 bytes of the digest as an unsigned 32-bit integer.
  const digest = crypto.createHash("md5").update(key).digest();
  return digest.readUInt32BE(0);
}

/**
 * A hash ring with virtual nodes. Each backend is placed at `virtualNodes`
 * points around the ring; a key is routed to the first backend clockwise
 * from the key's own hash. Adding or removing a backend only moves the keys
 * that fall in that backend's segments, which is the whole point of
 * consistent hashing over a plain modulo.
 */
export class HashRing {
  private points: RingPoint[] = [];
  private backendIds: Set<string> = new Set();

  constructor(private readonly virtualNodes: number = 100) {}

  add(backendId: string): void {
    if (this.backendIds.has(backendId)) {
      return;
    }
    this.backendIds.add(backendId);
    for (let i = 0; i < this.virtualNodes; i++) {
      this.points.push({ hash: hashKey(`${backendId}#${i}`), backendId });
    }
    this.points.sort((a, b) => a.hash - b.hash);
  }

  remove(backendId: string): void {
    if (!this.backendIds.has(backendId)) {
      return;
    }
    this.backendIds.delete(backendId);
    this.points = this.points.filter((p) => p.backendId !== backendId);
  }

  get size(): number {
    return this.backendIds.size;
  }

  /** Returns the backend id a key maps to, or null if the ring is empty. */
  get(key: string): string | null {
    if (this.points.length === 0) {
      return null;
    }
    const h = hashKey(key);
    const idx = this.firstPointAtOrAfter(h);
    return this.points[idx].backendId;
  }

  private firstPointAtOrAfter(h: number): number {
    let lo = 0;
    let hi = this.points.length - 1;
    if (h > this.points[hi].hash) {
      return 0; // wrap around the ring
    }
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.points[mid].hash < h) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
