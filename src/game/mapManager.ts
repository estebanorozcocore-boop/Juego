import { MapManifest, Rect, ZoneConfig } from '../types/game';

export class MapManager {
  width = 4200;
  height = 1120;
  interestRadius = 900.0;

  zones: Record<string, ZoneConfig> = {
    forest: {
      id: 'forest',
      name: 'Bosque del Umbral',
      kind: 'forest',
      index: 1,
      bounds: { x: 0, y: 0, width: 1800, height: 1120 },
      spawn: { x: 295, y: 580 },
      assetUrl: '/maps/forest.json',
    },
    corridor: {
      id: 'corridor',
      name: 'Paso de las Raíces',
      kind: 'corridor',
      index: 0,
      bounds: { x: 1800, y: 440, width: 600, height: 240 },
      spawn: { x: 2100, y: 560 },
      assetUrl: '/maps/corridor.json',
    },
    ruins: {
      id: 'ruins',
      name: 'Ruinas del Alba',
      kind: 'ruins',
      index: 2,
      bounds: { x: 2400, y: 0, width: 1800, height: 1120 },
      spawn: { x: 2500, y: 580 },
      assetUrl: '/maps/ruins.json',
    },
  };

  connections = [{ from: 'forest', via: 'corridor', to: 'ruins' }];

  obstacles: Rect[] = [
    { x: 2590, y: 190, width: 210, height: 170 },
    { x: 2900, y: 270, width: 110, height: 170 },
    { x: 3310, y: 160, width: 300, height: 180 },
    { x: 3850, y: 260, width: 160, height: 190 },
    { x: 2680, y: 770, width: 160, height: 200 },
    { x: 3090, y: 790, width: 270, height: 130 },
    { x: 3550, y: 740, width: 120, height: 250 },
    { x: 3900, y: 840, width: 170, height: 150 },
  ];

  voids: Rect[] = [
    { x: 1800, y: 0, width: 600, height: 440 },
    { x: 1800, y: 680, width: 600, height: 440 },
  ];

  assets: Record<string, ZoneConfig> = {
    forest: {
      ...this.zones.forest,
      seed: 71821,
      palette: { ground: '#172f26', alternate: '#203b2b', path: '#5b5841', accent: '#94bb77' },
      obstacles: [],
      decorations: [],
      description: 'Un bosque vivo custodiado por limos, fuegos fatuos y gólems.',
    },
    corridor: {
      ...this.zones.corridor,
      seed: 9281,
      palette: { ground: '#27332e', alternate: '#344239', path: '#696452', accent: '#b7c4a0' },
      obstacles: [],
      decorations: [],
      description: 'Un paso continuo entre el bosque y las ruinas.',
    },
    ruins: {
      ...this.zones.ruins,
      seed: 48217,
      palette: { ground: '#242c3b', alternate: '#303d4e', path: '#686b76', accent: '#c3b3ec' },
      obstacles: this.obstacles,
      decorations: [],
      description: 'Patios de piedra entre muros rotos, centinelas y sombras.',
    },
  };

  manifest(): MapManifest {
    return {
      width: this.width,
      height: this.height,
      zones: Object.entries(this.zones).map(([zoneId, zone]) => ({
        ...zone,
        obstacles: this.assets[zoneId]?.obstacles || [],
      })),
      connections: this.connections,
    };
  }

  zoneAt(x: number, y: number): string {
    for (const zoneId of ['ruins', 'corridor', 'forest'] as const) {
      const b = this.zones[zoneId].bounds;
      if (b.x <= x && x <= b.x + b.width && b.y <= y && y <= b.y + b.height) {
        return zoneId;
      }
    }
    return Object.keys(this.zones).reduce((best, zid) =>
      this.distanceToZone(x, y, zid) < this.distanceToZone(x, y, best) ? zid : best
    );
  }

  distanceToZone(x: number, y: number, zoneId: string): number {
    const b = this.zones[zoneId].bounds;
    const dx = Math.max(b.x - x, 0, x - b.x - b.width);
    const dy = Math.max(b.y - y, 0, y - b.y - b.height);
    return Math.hypot(dx, dy);
  }

  relevantZones(x: number, y: number): string[] {
    return Object.keys(this.zones).filter(
      (zid) => this.distanceToZone(x, y, zid) <= this.interestRadius
    );
  }

  static circleHitsRect(x: number, y: number, radius: number, rect: Rect): boolean {
    const left = rect.x;
    const top = rect.y;
    const right = left + rect.width;
    const bottom = top + rect.height;

    if (radius === 0) {
      return left < x && x < right && top < y && y < bottom;
    }
    const nearX = Math.max(left, Math.min(right, x));
    const nearY = Math.max(top, Math.min(bottom, y));
    return (x - nearX) ** 2 + (y - nearY) ** 2 < radius ** 2 - 1e-8;
  }

  walkable(x: number, y: number, radius: number = 17.0): boolean {
    if (radius > x || x > this.width - radius || radius > y || y > this.height - radius) {
      return false;
    }
    const colliders = [...this.voids, ...this.obstacles];
    return !colliders.some((rect) => MapManager.circleHitsRect(x, y, radius, rect));
  }

  move(x: number, y: number, dx: number, dy: number, radius: number = 17.0): [number, number] {
    const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / Math.max(1, radius * 0.45)));
    const sx = dx / count;
    const sy = dy / count;
    for (let i = 0; i < count; i++) {
      if (this.walkable(x + sx, y + sy, radius)) {
        x += sx;
        y += sy;
        continue;
      }
      if (this.walkable(x + sx, y, radius)) {
        x += sx;
      }
      if (this.walkable(x, y + sy, radius)) {
        y += sy;
      }
    }
    return [x, y];
  }

  static segmentHitsRect(ax: number, ay: number, bx: number, by: number, rect: Rect): boolean {
    let low = 0.0;
    let high = 1.0;
    const checks = [
      { start: ax, delta: bx - ax, near: rect.x, far: rect.x + rect.width },
      { start: ay, delta: by - ay, near: rect.y, far: rect.y + rect.height },
    ];

    for (const { start, delta, near, far } of checks) {
      if (Math.abs(delta) < 1e-9) {
        if (start <= near || start >= far) {
          return false;
        }
        continue;
      }
      let t1 = (near - start) / delta;
      let t2 = (far - start) / delta;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      low = Math.max(low, t1);
      high = Math.min(high, t2);
      if (low >= high) {
        return false;
      }
    }
    return high > 0 && low < 1;
  }

  lineOfSight(ax: number, ay: number, bx: number, by: number): boolean {
    if (!this.walkable(ax, ay, 0) || !this.walkable(bx, by, 0)) {
      return false;
    }
    const colliders = [...this.voids, ...this.obstacles];
    return !colliders.some((rect) => MapManager.segmentHitsRect(ax, ay, bx, by, rect));
  }

  castPoint(ax: number, ay: number, bx: number, by: number): [number, number] {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 4));
    let px = ax;
    let py = ay;
    for (let i = 1; i <= steps; i++) {
      const x = ax + ((bx - ax) * i) / steps;
      const y = ay + ((by - ay) * i) / steps;
      if (!this.walkable(x, y, 1)) {
        break;
      }
      px = x;
      py = y;
    }
    return [px, py];
  }

  respawnPoint(x: number, y: number): [number, number] {
    let zoneId = this.zoneAt(x, y);
    if (zoneId === 'corridor') {
      zoneId = x < 2100 ? 'forest' : 'ruins';
    }
    const spawn = this.zones[zoneId].spawn;
    return [spawn.x, spawn.y];
  }
}

export const MAPS = new MapManager();
