import { GameEvent, MapManifest, MonsterPublic, PlayerPublic, Rect, ZoneConfig } from '../types/game';
import { MAPS } from './mapManager';

const CHUNK = 384;
const PREFETCH = 1100;
const RELEASE = 1400;

const defaultPalettes: Record<string, { ground: string; alternate: string; path: string; accent: string }> = {
  forest: { ground: '#23443c', alternate: '#294e40', path: '#616850', accent: '#b8d4a0' },
  corridor: { ground: '#313c40', alternate: '#39484b', path: '#56605b', accent: '#a7cbc0' },
  ruins: { ground: '#302b41', alternate: '#3b344c', path: '#65575e', accent: '#d4b479' },
};

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function distanceToRect(p: { x: number; y: number }, b: Rect): number {
  return Math.hypot(Math.max(b.x - p.x, 0, p.x - b.x - b.width), Math.max(b.y - p.y, 0, p.y - b.y - b.height));
}

function rng(seed: number | string) {
  let n = Number(seed) || 71323;
  return () => {
    n = (Math.imul(1664525, n) + 1013904223) | 0;
    return (n >>> 0) / 4294967296;
  };
}

interface ChunkSurface {
  x: number;
  y: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

interface ZoneResource {
  id: string;
  status: 'fetching' | 'building' | 'ready';
  chunks: ChunkSurface[];
  asset: ZoneConfig;
}

export class WorldRenderer {
  manifest: MapManifest;
  resources: Map<string, ZoneResource> = new Map();
  renderedEntities: Map<string, { x: number; y: number }> = new Map();

  constructor() {
    this.manifest = MAPS.manifest();
  }

  setManifest(manifest: MapManifest) {
    if (manifest?.zones?.length) {
      this.manifest = manifest;
    }
  }

  zoneAt(p: { x: number; y: number }): ZoneConfig | undefined {
    return [...this.manifest.zones]
      .reverse()
      .find(
        (z) =>
          p.x >= z.bounds.x &&
          p.x <= z.bounds.x + z.bounds.width &&
          p.y >= z.bounds.y &&
          p.y <= z.bounds.y + z.bounds.height
      );
  }

  updateResources(p: { x: number; y: number }, camera: { x: number; y: number }, viewport: { w: number; h: number }) {
    const view: Rect = { x: camera.x, y: camera.y, width: viewport.w, height: viewport.h };
    for (const zone of this.manifest.zones) {
      const d = distanceToRect(p, zone.bounds);
      const inView = intersects(zone.bounds, view);
      if (d < PREFETCH || inView) {
        this.prepareZone(zone);
      }
      const resource = this.resources.get(zone.id);
      if (resource && d > RELEASE && !inView) {
        resource.chunks.forEach((c) => {
          c.canvas.width = 0;
          c.canvas.height = 0;
        });
        resource.chunks = [];
        this.resources.delete(zone.id);
      }
    }
  }

  prepareZone(zone: ZoneConfig) {
    if (this.resources.has(zone.id)) return;
    const asset = MAPS.assets[zone.id] || zone;
    const resource: ZoneResource = {
      id: zone.id,
      status: 'building',
      chunks: [],
      asset,
    };
    this.resources.set(zone.id, resource);
    this.buildChunks(resource);
  }

  buildChunks(resource: ZoneResource) {
    const asset = resource.asset;
    const b = asset.bounds;
    const jobs: Array<{ x: number; y: number; width: number; height: number }> = [];
    for (let y = b.y; y < b.y + b.height; y += CHUNK) {
      for (let x = b.x; x < b.x + b.width; x += CHUNK) {
        jobs.push({
          x,
          y,
          width: Math.min(CHUNK, b.x + b.width - x),
          height: Math.min(CHUNK, b.y + b.height - y),
        });
      }
    }

    for (const tile of jobs) {
      const surface = document.createElement('canvas');
      surface.width = tile.width;
      surface.height = tile.height;
      const c = surface.getContext('2d');
      if (c) {
        c.translate(-tile.x, -tile.y);
        this.paintGround(c, asset, tile);
        resource.chunks.push({ ...tile, canvas: surface });
      }
    }
    resource.status = 'ready';
  }

  paintGround(
    c: CanvasRenderingContext2D,
    asset: ZoneConfig,
    tile: { x: number; y: number; width: number; height: number }
  ) {
    const b = asset.bounds;
    const kind = asset.kind || asset.id;
    const palette = { ...(defaultPalettes[kind] || defaultPalettes.forest), ...asset.palette };

    c.fillStyle = palette.ground;
    c.fillRect(tile.x, tile.y, tile.width, tile.height);

    const tileSize = kind === 'ruins' ? 64 : 80;
    for (let x = Math.floor(tile.x / tileSize) * tileSize; x < tile.x + tile.width; x += tileSize) {
      for (let y = Math.floor(tile.y / tileSize) * tileSize; y < tile.y + tile.height; y += tileSize) {
        const n = Math.abs(Math.sin(x * 0.13 + y * 0.71 + (Number(asset.seed) || 1)));
        c.fillStyle = n > 0.66 ? palette.alternate : palette.ground;
        c.fillRect(x, y, tileSize, tileSize);
        if (kind === 'ruins') {
          c.strokeStyle = '#b9a6c71c';
          c.lineWidth = 1;
          c.strokeRect(x + 2, y + 2, tileSize - 4, tileSize - 4);
        }
      }
    }

    c.save();
    c.beginPath();
    c.rect(b.x, b.y, b.width, b.height);
    c.clip();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(b.x, 560);
    if (kind === 'forest') {
      c.bezierCurveTo(360, 520, 620, 620, 970, 545);
      c.bezierCurveTo(1270, 505, 1530, 580, 1800, 560);
    } else {
      c.lineTo(b.x + b.width, 560);
    }
    c.lineWidth = kind === 'corridor' ? 110 : 88;
    c.strokeStyle = palette.path;
    c.stroke();
    c.lineWidth = 2;
    c.strokeStyle = kind === 'ruins' ? '#bd9b6550' : '#b4bd8540';
    c.setLineDash([5, 23]);
    c.stroke();
    c.setLineDash([]);

    if (kind === 'forest') {
      c.beginPath();
      c.moveTo(710, 0);
      c.bezierCurveTo(780, 250, 640, 320, 760, 550);
      c.bezierCurveTo(960, 810, 910, 940, 985, 1120);
      c.lineWidth = 42;
      c.strokeStyle = '#526044';
      c.stroke();
    }

    const random = rng(asset.seed || 71323);
    const count = kind === 'forest' ? 430 : kind === 'ruins' ? 220 : 65;
    for (let i = 0; i < count; i++) {
      const x = b.x + 20 + random() * (b.width - 40);
      const y = b.y + 20 + random() * (b.height - 40);
      const size = 2 + random() * 6;
      const type = random();
      if (x < tile.x - 12 || x > tile.x + tile.width + 12 || y < tile.y - 12 || y > tile.y + tile.height + 12) {
        continue;
      }
      if (kind === 'forest') {
        if (type < 0.6) {
          c.strokeStyle = '#57956680';
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(x - 3, y + 3);
          c.lineTo(x - 1, y - 3);
          c.moveTo(x, y + 3);
          c.lineTo(x + 4, y - 5);
          c.stroke();
        } else if (type < 0.8) {
          c.fillStyle = '#487452';
          c.beginPath();
          c.ellipse(x, y, size + 2, size * 0.6, 0, 0, 7);
          c.fill();
        } else {
          c.fillStyle = type > 0.94 ? '#d7cb98' : '#8b9a84';
          c.fillRect(x, y, size * 0.6, size * 0.4);
        }
      } else {
        c.strokeStyle = kind === 'ruins' ? '#c1a97950' : '#90aca13b';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + size, y + size * 0.4);
        c.lineTo(x + size * 0.5, y + size);
        c.stroke();
      }
    }
    c.restore();
  }

  drawWorld(
    c: CanvasRenderingContext2D,
    camera: { x: number; y: number },
    viewport: { w: number; h: number },
    now: number
  ) {
    const view: Rect = { x: camera.x, y: camera.y, width: viewport.w, height: viewport.h };
    c.fillStyle = '#0d171e';
    c.fillRect(view.x, view.y, view.width, view.height);

    for (const zone of this.manifest.zones) {
      if (!intersects(zone.bounds, view)) continue;
      const resource = this.resources.get(zone.id);
      const asset = resource?.asset || MAPS.assets[zone.id] || zone;
      const b = zone.bounds;
      const kind = zone.kind || zone.id;
      const palette = { ...(defaultPalettes[kind] || defaultPalettes.forest), ...asset.palette };

      c.save();
      c.beginPath();
      c.rect(b.x, b.y, b.width, b.height);
      c.clip();
      c.fillStyle = palette.ground;
      c.fillRect(b.x, b.y, b.width, b.height);
      c.fillStyle = palette.path;
      c.fillRect(b.x, 516, b.width, 88);

      for (const chunk of resource?.chunks || []) {
        if (intersects(chunk, view)) {
          c.drawImage(chunk.canvas, chunk.x, chunk.y);
        }
      }
      c.restore();

      if (kind === 'corridor') this.drawCorridor(c, b, now);

      for (const ob of asset.obstacles || zone.obstacles || []) {
        if (!intersects({ x: ob.x, y: ob.y, width: ob.width + 12, height: ob.height + 12 }, view)) continue;
        c.fillStyle = '#09101770';
        c.fillRect(ob.x + 8, ob.y + 9, ob.width, ob.height);
        c.fillStyle = kind === 'ruins' ? '#706777' : '#536660';
        c.fillRect(ob.x, ob.y, ob.width, ob.height);
        c.strokeStyle = kind === 'ruins' ? '#c5ab7b' : '#98b09b';
        c.lineWidth = 2;
        c.strokeRect(ob.x + 1, ob.y + 1, ob.width - 2, ob.height - 2);
        c.fillStyle = kind === 'ruins' ? '#918392' : '#6f8272';
        c.fillRect(ob.x + 5, ob.y + 5, Math.max(0, ob.width - 10), Math.min(9, ob.height - 10));
        if (kind === 'ruins' && ob.width > 35 && ob.height > 35) {
          c.strokeStyle = '#d7b77777';
          c.strokeRect(ob.x + 12, ob.y + 14, ob.width - 24, ob.height - 26);
        }
      }

      if (kind === 'forest') this.sanctuary(c, zone.spawn || { x: 295, y: 580 }, palette.accent);
      if (kind === 'ruins') {
        c.strokeStyle = '#c0a2d933';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(3370, 560, 140, 0, Math.PI * 2);
        c.stroke();
        c.beginPath();
        c.arc(3370, 560, 128, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#ddc38b99';
        c.font = '600 12px ui-monospace,monospace';
        c.textAlign = 'center';
        c.fillText('RUINAS DEL ALBA', 3370, 746);
      }
    }

    this.sign(c, 1570, 560, 'RUINAS', 1);
    this.sign(c, 2620, 560, 'BOSQUE', -1);
  }

  drawCorridor(c: CanvasRenderingContext2D, b: Rect, now: number) {
    for (const y of [b.y, b.y + b.height]) {
      c.fillStyle = '#182a2e';
      c.fillRect(b.x, y === b.y ? y - 65 : y, b.width, 65);
      for (let x = b.x; x < b.x + b.width; x += 48) {
        c.fillStyle = ((x - b.x) / 48) % 2 ? '#35494a' : '#2b3e41';
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 14, y + (y === b.y ? -45 : 45));
        c.lineTo(x + 39, y + (y === b.y ? -58 : 58));
        c.lineTo(x + 49, y);
        c.closePath();
        c.fill();
      }
      c.strokeStyle = '#76968a66';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(b.x, y);
      c.lineTo(b.x + b.width, y);
      c.stroke();
    }
    for (const x of [1860, 2060, 2260]) {
      for (const y of [462, 658]) {
        c.fillStyle = '#6c7d79';
        c.fillRect(x - 4, y - 7, 8, 14);
        c.fillStyle = '#dfc189';
        c.beginPath();
        c.arc(x, y - 5, 3 + Math.sin(now * 0.004 + x) * 0.6, 0, 7);
        c.fill();
      }
    }
    c.fillStyle = '#b5cabe88';
    c.font = '600 10px ui-monospace,monospace';
    c.textAlign = 'center';
    c.fillText('PASO DE LAS RAÍCES', 2100, 506);
  }

  sanctuary(c: CanvasRenderingContext2D, p: { x: number; y: number }, color: string) {
    c.beginPath();
    c.arc(p.x, p.y, 66, 0, Math.PI * 2);
    c.fillStyle = '#89c4aa15';
    c.fill();
    c.strokeStyle = '#94d1b755';
    c.lineWidth = 2;
    c.stroke();
    c.beginPath();
    c.arc(p.x, p.y, 43, 0, Math.PI * 2);
    c.strokeStyle = '#b4d5b760';
    c.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      c.fillStyle = color;
      c.fillRect(p.x + Math.cos(a) * 61 - 2, p.y + Math.sin(a) * 61 - 2, 5, 5);
    }
    c.fillStyle = '#bdd4bc';
    c.font = '700 10px ui-monospace,monospace';
    c.textAlign = 'center';
    c.fillText('SANTUARIO', p.x, p.y - 93);
  }

  sign(c: CanvasRenderingContext2D, x: number, y: number, label: string, dir: number) {
    c.fillStyle = '#14242ac9';
    c.fillRect(x - 63, y + 52, 126, 32);
    c.strokeStyle = '#85968888';
    c.lineWidth = 1;
    c.strokeRect(x - 63, y + 52, 126, 32);
    c.fillStyle = '#d9d7b6';
    c.font = '700 10px ui-monospace,monospace';
    c.textAlign = 'center';
    c.fillText(dir > 0 ? `${label} →` : `← ${label}`, x, y + 72);
  }

  entityPosition(id: string, entity: { x: number; y: number }, isMe: boolean): { x: number; y: number } {
    let r = this.renderedEntities.get(id);
    if (!r) {
      r = { x: entity.x, y: entity.y };
      this.renderedEntities.set(id, r);
    }
    if (Math.hypot(r.x - entity.x, r.y - entity.y) > 250) {
      r.x = entity.x;
      r.y = entity.y;
    }
    const t = isMe ? 0.34 : 0.22;
    r.x = r.x + (entity.x - r.x) * t;
    r.y = r.y + (entity.y - r.y) * t;
    return r;
  }

  drawMonster(
    ctx: CanvasRenderingContext2D,
    m: MonsterPublic,
    player: PlayerPublic | undefined,
    camera: { x: number; y: number },
    viewport: { w: number; h: number },
    now: number
  ) {
    if (m.dead) return;
    const pos = this.entityPosition(m.id, m, false);
    const x = pos.x;
    const y = pos.y;
    const r = m.detection + 30;
    if (x + r < camera.x || x - r > camera.x + viewport.w || y + r < camera.y || y - r > camera.y + viewport.h) {
      return;
    }

    const inRange = player && !player.dead && Math.hypot(player.x - m.x, player.y - m.y) <= m.detection;
    if (inRange) {
      ctx.beginPath();
      ctx.arc(x, y, m.detection, 0, 7);
      ctx.fillStyle = '#e0a16c0e';
      ctx.fill();
      ctx.strokeStyle = '#edb16d55';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 9]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const bob = Math.sin(now * 0.004 + x) * 2;
    ctx.beginPath();
    ctx.ellipse(x, y + 14, 18, 7, 0, 0, 7);
    ctx.fillStyle = '#0e1f2388';
    ctx.fill();

    if (m.kind === 'slime') {
      ctx.beginPath();
      ctx.ellipse(x, y - 2 + bob, 18, 15, 0, Math.PI, Math.PI * 2);
      ctx.lineTo(x + 18, y + 10 + bob);
      ctx.quadraticCurveTo(x, y + 19 + bob, x - 18, y + 10 + bob);
      ctx.closePath();
      ctx.fillStyle = '#c6a56b';
      ctx.fill();
      ctx.strokeStyle = '#ffe0a0';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.fillStyle = '#423c36';
      ctx.fillRect(x - 6, y - 1 + bob, 3, 4);
      ctx.fillRect(x + 4, y - 1 + bob, 3, 4);
    } else if (m.kind === 'sentinel') {
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.fillStyle = '#746582';
      ctx.strokeStyle = '#dcc18c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -29);
      ctx.lineTo(23, -9);
      ctx.lineTo(18, 18);
      ctx.lineTo(-18, 18);
      ctx.lineTo(-23, -9);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#dab771';
      ctx.fillRect(-20, -8, 40, 7);
      ctx.fillStyle = '#f8ead0';
      ctx.fillRect(-4, -6, 8, 5);
      ctx.strokeStyle = '#baa0d2';
      ctx.beginPath();
      ctx.moveTo(-27, -19);
      ctx.lineTo(-27, 22);
      ctx.stroke();
      ctx.restore();
    } else if (m.kind === 'shade') {
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.shadowBlur = 14;
      ctx.shadowColor = '#b7a0f2';
      ctx.fillStyle = '#746b9bcc';
      ctx.strokeStyle = '#c5b6ef';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.quadraticCurveTo(23, -14, 15, 7);
      ctx.lineTo(19, 23);
      ctx.lineTo(2, 16);
      ctx.lineTo(-17, 24);
      ctx.lineTo(-12, 5);
      ctx.quadraticCurveTo(-22, -16, 0, -24);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f2e1b5';
      ctx.fillRect(-7, -9, 4, 3);
      ctx.fillRect(4, -9, 4, 3);
      ctx.restore();
    } else if (m.kind === 'wisp') {
      ctx.shadowBlur = 19;
      ctx.shadowColor = '#db91dc';
      ctx.fillStyle = '#a277a9';
      ctx.beginPath();
      ctx.arc(x, y - 5 + bob, 14, 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#f1d2ff';
      ctx.fillRect(x - 5, y - 8 + bob, 4, 3);
      ctx.fillRect(x + 3, y - 8 + bob, 4, 3);
      ctx.fillStyle = '#c79dcb';
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 8 + bob);
      ctx.lineTo(x, y + 20 + bob);
      ctx.lineTo(x + 7, y + 7 + bob);
      ctx.fill();
    } else {
      // Golem
      this.roundRect(ctx, x - 19, y - 22 + bob, 38, 37, 5, '#9c7359', '#d2ab78');
      ctx.fillStyle = '#e9c17a';
      ctx.fillRect(x - 9, y - 9 + bob, 5, 4);
      ctx.fillRect(x + 5, y - 9 + bob, 5, 4);
      ctx.fillStyle = '#6f5648';
      ctx.fillRect(x - 14, y + 9 + bob, 11, 10);
      ctx.fillRect(x + 4, y + 9 + bob, 11, 10);
    }

    this.healthbar(ctx, x, y - 37, m.hp, m.maxHp, ['golem', 'sentinel'].includes(m.kind) ? 53 : 42);
    if (inRange) {
      ctx.fillStyle = '#ffd7a0';
      ctx.font = '700 9px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('¡ALERTA!', x, y - 48);
    }
  }

  drawPlayer(
    ctx: CanvasRenderingContext2D,
    p: PlayerPublic,
    myId: string | null,
    camera: { x: number; y: number },
    viewport: { w: number; h: number }
  ) {
    const isMe = p.id === myId;
    const v = this.entityPosition(p.id, p, isMe);
    const x = v.x;
    const y = v.y;
    if (x + 50 < camera.x || x - 50 > camera.x + viewport.w || y + 50 < camera.y || y - 50 > camera.y + viewport.h) {
      return;
    }

    const r = p.dead ? 0.35 : 1;
    ctx.save();
    ctx.globalAlpha = r;
    ctx.beginPath();
    ctx.ellipse(x, y + 15, 17, 6, 0, 0, 7);
    ctx.fillStyle = '#0e1e2888';
    ctx.fill();

    if (isMe) {
      ctx.beginPath();
      ctx.arc(x, y, 26, 0, 7);
      ctx.strokeStyle = '#bae5a1';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const face = Math.atan2(p.dy, p.dx);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(face + Math.PI / 2);
    this.roundRect(ctx, -15, -14, 30, 30, 5, isMe ? '#4daab8' : '#6c8fa9', isMe ? '#d3f8e6' : '#cadceb');
    ctx.fillStyle = '#b2e7e4';
    ctx.fillRect(-10, -10, 20, 7);
    ctx.fillStyle = '#174351';
    ctx.fillRect(-8, -7, 16, 9);
    ctx.fillStyle = '#f0e7c9';
    ctx.fillRect(-6, 4, 12, 3);
    ctx.fillStyle = '#e8e8d8';
    ctx.fillRect(16, -7, 4, 24);
    ctx.fillStyle = '#e7c487';
    ctx.fillRect(13, 10, 11, 4);
    ctx.restore();
    ctx.restore();

    if (isMe) {
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(face) * 24, y + Math.sin(face) * 24);
      ctx.lineTo(x + Math.cos(face - 0.2) * 32, y + Math.sin(face - 0.2) * 32);
      ctx.lineTo(x + Math.cos(face + 0.2) * 32, y + Math.sin(face + 0.2) * 32);
      ctx.closePath();
      ctx.fillStyle = '#d0e8a5';
      ctx.fill();
    }

    ctx.font = '700 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#ecffd9' : '#f1f6f2';
    ctx.fillText(p.name, x, y - 35);
    this.healthbar(ctx, x, y - 29, p.hp, p.maxHp, 54);
  }

  drawEffects(ctx: CanvasRenderingContext2D, effects: GameEvent[], now: number) {
    for (const e of effects) {
      const born = e.born || now;
      const age = now - born;
      const alpha = 1 - Math.max(0, Math.min(1, age / 800));
      ctx.save();
      ctx.globalAlpha = alpha;

      if (e.kind === 'nova') {
        const radius = e.radius || 92;
        const currentR = 18 + radius * Math.max(0, Math.min(1, age / 350));
        ctx.beginPath();
        ctx.arc(e.x, e.y, currentR, 0, 7);
        ctx.strokeStyle = '#c9a2fc';
        ctx.lineWidth = 6 * (1 - age / 800) + 1;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.x, e.y, currentR * 0.63, 0, 7);
        ctx.strokeStyle = '#f7d5ff';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (e.kind === 'slash') {
        const angle = Math.atan2(e.dy || 0, e.dx || 1);
        ctx.beginPath();
        ctx.arc(e.x, e.y, 84, angle - 0.78, angle + 0.78);
        ctx.strokeStyle = '#d8f6de';
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(e.x, e.y, 71, angle - 0.78, angle + 0.78);
        ctx.strokeStyle = '#e5ae68';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (e.kind === 'damage' || e.kind === 'hurt') {
        ctx.font = '900 17px system-ui';
        ctx.textAlign = 'center';
        ctx.fillStyle = e.kind === 'hurt' ? '#ffb3a7' : '#ffe7a9';
        ctx.strokeStyle = '#15242b';
        ctx.lineWidth = 3;
        const textY = e.y - age * 0.055;
        ctx.strokeText(`−${e.amount || 0}`, e.x, textY);
        ctx.fillText(`−${e.amount || 0}`, e.x, textY);
      } else if (e.kind === 'monster_attack') {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.tx || e.x, e.ty || e.y);
        ctx.strokeStyle = '#f29674';
        ctx.lineWidth = 4;
        ctx.stroke();
      } else if (e.kind === 'death') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 20 + age * 0.065, 0, 7);
        ctx.strokeStyle = '#e3977a';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (e.kind === 'join' || e.kind === 'respawn') {
        ctx.beginPath();
        ctx.arc(e.x, e.y, 15 + age * 0.08, 0, 7);
        ctx.strokeStyle = '#a2e5cb';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawMinimap(
    mtx: CanvasRenderingContext2D,
    w: number,
    h: number,
    players: PlayerPublic[],
    monsters: MonsterPublic[],
    myId: string | null,
    currentZoneId: string,
    camera: { x: number; y: number },
    viewport: { w: number; h: number },
    zoneCounts: Record<string, number>
  ) {
    const padding = 12;
    const worldW = this.manifest.width;
    const worldH = this.manifest.height;
    const scale = (w - padding * 2) / worldW;
    const oy = (h - worldH * scale) / 2;
    const px = (x: number) => padding + x * scale;
    const py = (y: number) => oy + y * scale;

    mtx.clearRect(0, 0, w, h);
    mtx.fillStyle = '#0c1a22';
    mtx.fillRect(0, 0, w, h);

    for (const zone of this.manifest.zones) {
      const b = zone.bounds;
      mtx.fillStyle = zone.id === 'forest' ? '#2a5343' : zone.id === 'ruins' ? '#4e405b' : '#506164';
      mtx.fillRect(px(b.x), py(b.y), b.width * scale, b.height * scale);
      mtx.strokeStyle = currentZoneId === zone.id ? '#d3e4ac' : '#7e9b8644';
      mtx.lineWidth = currentZoneId === zone.id ? 2 : 1;
      mtx.strokeRect(px(b.x), py(b.y), b.width * scale, b.height * scale);

      if (zone.id !== 'corridor') {
        mtx.fillStyle = '#b7c8b9';
        mtx.textAlign = 'center';
        mtx.font = '700 9px system-ui';
        mtx.fillText(zone.id === 'forest' ? 'BOSQUE' : 'RUINAS', px(b.x + b.width / 2), oy - 10);
        const count = zoneCounts[zone.id] || 0;
        mtx.fillStyle = '#91aa9e';
        mtx.font = '9px system-ui';
        mtx.fillText(
          `${count} explorador${count === 1 ? '' : 'es'}`,
          px(b.x + b.width / 2),
          py(worldH) + 19
        );
      }
    }

    mtx.strokeStyle = '#a5b39555';
    mtx.lineWidth = 2;
    mtx.beginPath();
    mtx.moveTo(px(295), py(560));
    mtx.lineTo(px(3900), py(560));
    mtx.stroke();

    for (const m of monsters) {
      if (m.dead) continue;
      mtx.fillStyle = '#eba769';
      mtx.fillRect(px(m.x) - 1.5, py(m.y) - 1.5, 3, 3);
    }

    for (const p of players) {
      if (p.dead) continue;
      const mine = p.id === myId;
      mtx.fillStyle = mine ? '#d3f3af' : '#71d6fa';
      mtx.beginPath();
      mtx.arc(px(p.x), py(p.y), mine ? 4 : 2.5, 0, 7);
      mtx.fill();
    }

    mtx.strokeStyle = '#def7e299';
    mtx.lineWidth = 1;
    mtx.strokeRect(
      px(camera.x),
      py(camera.y),
      Math.min(viewport.w, worldW) * scale,
      Math.min(viewport.h, worldH) * scale
    );

    mtx.fillStyle = '#78918c';
    mtx.textAlign = 'center';
    mtx.font = '8px system-ui';
    mtx.fillText('UN SOLO MUNDO · PASO DE LAS RAÍCES', w / 2, h - 10);
  }

  roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    fill: string,
    stroke?: string
  ) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  healthbar(ctx: CanvasRenderingContext2D, x: number, y: number, hp: number, max: number, width: number = 50) {
    ctx.fillStyle = '#1e252d';
    ctx.fillRect(x - width / 2, y, width, 6);
    ctx.fillStyle = hp / max > 0.5 ? '#92ca93' : hp / max > 0.25 ? '#e4b46e' : '#e77c78';
    ctx.fillRect(x - width / 2 + 1, y + 1, Math.max(0, ((width - 2) * hp) / max), 4);
  }
}
