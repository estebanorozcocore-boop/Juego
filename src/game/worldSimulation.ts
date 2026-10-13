import { MAPS } from './mapManager';
import {
  ClientMessage,
  GameEvent,
  MonsterPublic,
  PlayerPublic,
  ServerStateSnapshot,
} from '../types/game';

export const PLAYER_SPEED = 225.0;
export const PLAYER_RADIUS = 17.0;
export const PLAYER_MAX_HP = 100;
export const BASIC_RANGE = 100.0;
export const BASIC_ARC = (88 * Math.PI) / 180;
export const BASIC_DAMAGE = 18;
export const BASIC_COOLDOWN = 0.48;
export const POWER_RANGE = 320.0;
export const POWER_RADIUS = 92.0;
export const POWER_DAMAGE = 42;
export const POWER_COOLDOWN = 3.4;
export const MONSTER_RESPAWN = 9.0;
export const SPAWN: [number, number] = [295.0, 580.0];

function clamp(x: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, x));
}

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function normalized(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  return l > 1e-8 ? [x / l, y / l] : [0.0, 0.0];
}

export class SimPlayer {
  id: string;
  name: string;
  x: number = SPAWN[0];
  y: number = SPAWN[1];
  hp: number = PLAYER_MAX_HP;
  dx: number = 1.0;
  dy: number = 0.0;
  moveX: number = 0.0;
  moveY: number = 0.0;
  basicReady: number = 0.0;
  powerReady: number = 0.0;
  deadUntil: number = 0.0;
  kills: number = 0;
  lastInput: number = 0;
  joined: boolean = false;
  sendCallback?: (snapshotStr: string) => void;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  public(now: number): PlayerPublic {
    return {
      id: this.id,
      name: this.name,
      x: Number(this.x.toFixed(1)),
      y: Number(this.y.toFixed(1)),
      hp: this.hp,
      maxHp: PLAYER_MAX_HP,
      dx: Number(this.dx.toFixed(3)),
      dy: Number(this.dy.toFixed(3)),
      basicRemaining: Number(Math.max(0, this.basicReady - now).toFixed(2)),
      powerRemaining: Number(Math.max(0, this.powerReady - now).toFixed(2)),
      dead: this.hp <= 0,
      kills: this.kills,
      zoneId: MAPS.zoneAt(this.x, this.y),
    };
  }
}

export class SimMonster {
  id: string;
  kind: string;
  homeX: number;
  homeY: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  detection: number;
  attack: number;
  reach: number = 48.0;
  attackReady: number = 0.0;
  respawnAt: number = 0.0;
  faceX: number = -1.0;
  faceY: number = 0.0;

  constructor(
    id: string,
    kind: string,
    x: number,
    y: number,
    hp: number,
    speed: number,
    detection: number,
    attack: number
  ) {
    this.id = id;
    this.kind = kind;
    this.homeX = x;
    this.homeY = y;
    this.x = x;
    this.y = y;
    this.hp = hp;
    this.maxHp = hp;
    this.speed = speed;
    this.detection = detection;
    this.attack = attack;
  }

  public(): MonsterPublic {
    return {
      id: this.id,
      kind: this.kind,
      x: Number(this.x.toFixed(1)),
      y: Number(this.y.toFixed(1)),
      hp: this.hp,
      maxHp: this.maxHp,
      detection: this.detection,
      dx: Number(this.faceX.toFixed(2)),
      dy: Number(this.faceY.toFixed(2)),
      dead: this.hp <= 0,
      zoneId: MAPS.zoneAt(this.x, this.y),
    };
  }
}

export class WorldSimulation {
  players: Map<string, SimPlayer> = new Map();
  monsters: SimMonster[] = [];
  events: GameEvent[] = [];
  startTime: number = performance.now();

  constructor() {
    const seeds: Array<[string, number, number, number, number, number, number]> = [
      ['slime', 535, 330, 75, 85, 190, 8],
      ['slime', 665, 775, 75, 85, 195, 8],
      ['slime', 815, 505, 75, 85, 210, 8],
      ['wisp', 1100, 275, 58, 110, 240, 11],
      ['wisp', 1230, 730, 58, 110, 245, 11],
      ['slime', 1420, 410, 75, 85, 205, 8],
      ['golem', 1520, 905, 170, 58, 230, 17],
      ['golem', 1005, 930, 170, 58, 215, 17],
      ['sentinel', 2820, 390, 150, 66, 215, 15],
      ['shade', 3010, 690, 62, 125, 205, 10],
      ['shade', 3180, 230, 62, 125, 210, 10],
      ['sentinel', 3420, 640, 150, 66, 220, 15],
      ['shade', 3780, 750, 62, 125, 220, 10],
      ['sentinel', 3990, 640, 150, 66, 210, 15],
      ['shade', 3720, 190, 62, 125, 210, 10],
    ];

    seeds.forEach(([kind, x, y, hp, speed, detection, damage], i) => {
      this.monsters.push(
        new SimMonster(`m${i + 1}`, kind, x, y, hp, speed, detection, damage)
      );
    });
  }

  now(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  spawnPlayer(name: string, sendCallback?: (snapshotStr: string) => void): SimPlayer {
    const id = Math.random().toString(36).substring(2, 11);
    const p = new SimPlayer(id, name);
    p.x += (Math.random() - 0.5) * 52;
    p.y += (Math.random() - 0.5) * 52;
    p.lastInput = this.now();
    p.joined = true;
    p.sendCallback = sendCallback;
    this.players.set(p.id, p);
    this.addEvent({ kind: 'join', x: p.x, y: p.y, name: p.name });
    return p;
  }

  removePlayer(id: string): void {
    const p = this.players.get(id);
    if (p) {
      this.addEvent({ kind: 'leave', x: p.x, y: p.y, name: p.name });
      this.players.delete(id);
    }
  }

  addEvent(event: GameEvent): void {
    const x = Number(event.x.toFixed(1));
    const y = Number(event.y.toFixed(1));
    this.events.push({
      ...event,
      x,
      y,
      zoneId: event.zoneId || MAPS.zoneAt(x, y),
    });
  }

  hurtMonster(m: SimMonster, amount: number, actor: SimPlayer, now: number): void {
    if (m.hp <= 0) return;
    m.hp = Math.max(0, m.hp - amount);
    this.addEvent({ kind: 'damage', x: m.x, y: m.y - 19, amount, target: m.id });
    if (m.hp === 0) {
      m.respawnAt = now + MONSTER_RESPAWN;
      actor.kills += 1;
      this.addEvent({ kind: 'death', x: m.x, y: m.y, target: m.id });
    }
  }

  hurtPlayer(p: SimPlayer, amount: number, now: number): void {
    if (p.hp <= 0) return;
    p.hp = Math.max(0, p.hp - amount);
    this.addEvent({ kind: 'hurt', x: p.x, y: p.y - 21, amount, target: p.id });
    if (p.hp === 0) {
      p.deadUntil = now + 4.0;
      p.moveX = 0;
      p.moveY = 0;
      this.addEvent({ kind: 'death', x: p.x, y: p.y, target: p.id });
    }
  }

  attackBasic(p: SimPlayer, now: number): void {
    if (p.hp <= 0 || now < p.basicReady) return;
    p.basicReady = now + BASIC_COOLDOWN;
    this.addEvent({ kind: 'slash', x: p.x, y: p.y, dx: p.dx, dy: p.dy });

    for (const m of this.monsters) {
      if (m.hp <= 0) continue;
      const vx = m.x - p.x;
      const vy = m.y - p.y;
      const d = Math.hypot(vx, vy);
      if (d > BASIC_RANGE + 17 || d < 1e-5) continue;
      const dot = (vx * p.dx + vy * p.dy) / d;
      if (dot >= Math.cos(BASIC_ARC * 0.5) && MAPS.lineOfSight(p.x, p.y, m.x, m.y)) {
        this.hurtMonster(m, BASIC_DAMAGE, p, now);
      }
    }
  }

  attackPower(p: SimPlayer, targetX: number, targetY: number, now: number): void {
    if (p.hp <= 0 || now < p.powerReady) return;
    let vx = targetX - p.x;
    let vy = targetY - p.y;
    const d = Math.hypot(vx, vy);
    if (d > POWER_RANGE) {
      vx = (vx / d) * POWER_RANGE;
      vy = (vy / d) * POWER_RANGE;
      targetX = p.x + vx;
      targetY = p.y + vy;
    }
    const [castX, castY] = MAPS.castPoint(p.x, p.y, targetX, targetY);
    p.powerReady = now + POWER_COOLDOWN;
    this.addEvent({ kind: 'nova', x: castX, y: castY, radius: POWER_RADIUS });

    for (const m of this.monsters) {
      if (
        m.hp > 0 &&
        distance([m.x, m.y], [castX, castY]) <= POWER_RADIUS + 16 &&
        MAPS.lineOfSight(castX, castY, m.x, m.y)
      ) {
        this.hurtMonster(m, POWER_DAMAGE, p, now);
      }
    }
  }

  handleAction(p: SimPlayer, message: ClientMessage): void {
    const now = this.now();
    if (!p.joined) return;

    if (message.type === 'input') {
      const mx = clamp(Number.isFinite(message.mx) ? message.mx : 0, -1, 1);
      const my = clamp(Number.isFinite(message.my) ? message.my : 0, -1, 1);
      const [nx, ny] = normalized(mx, my);
      p.moveX = nx;
      p.moveY = ny;

      const ax = Number.isFinite(message.aimX) ? message.aimX : p.x + p.dx;
      const ay = Number.isFinite(message.aimY) ? message.aimY : p.y + p.dy;
      const [adx, ady] = normalized(ax - p.x, ay - p.y);
      if (adx !== 0 || ady !== 0) {
        p.dx = adx;
        p.dy = ady;
      }
      p.lastInput = now;
    } else if (message.type === 'basic') {
      this.attackBasic(p, now);
    } else if (message.type === 'power') {
      const x = Number.isFinite(message.x) ? message.x : p.x;
      const y = Number.isFinite(message.y) ? message.y : p.y;
      this.attackPower(p, x, y, now);
    }
  }

  tick(dt: number, now: number): void {
    // Update players
    for (const p of this.players.values()) {
      if (p.hp <= 0) {
        if (now >= p.deadUntil) {
          p.hp = PLAYER_MAX_HP;
          const [rx, ry] = MAPS.respawnPoint(p.x, p.y);
          p.x = rx;
          p.y = ry;
          this.addEvent({ kind: 'respawn', x: p.x, y: p.y, target: p.id });
        }
        continue;
      }
      if (now - p.lastInput < 0.6) {
        const [nx, ny] = MAPS.move(
          p.x,
          p.y,
          p.moveX * PLAYER_SPEED * dt,
          p.moveY * PLAYER_SPEED * dt,
          PLAYER_RADIUS
        );
        p.x = nx;
        p.y = ny;
      }
    }

    // Update monsters
    for (const m of this.monsters) {
      if (m.hp <= 0) {
        if (now >= m.respawnAt) {
          m.hp = m.maxHp;
          m.x = m.homeX;
          m.y = m.homeY;
          this.addEvent({ kind: 'respawn', x: m.x, y: m.y, target: m.id });
        }
        continue;
      }

      const targets = Array.from(this.players.values()).filter(
        (p) => p.hp > 0 && distance([p.x, p.y], [m.homeX, m.homeY]) <= m.detection
      );

      if (targets.length === 0) {
        this.moveToward(m, m.homeX, m.homeY, dt);
        continue;
      }

      let closest = targets[0];
      let minDist = distance([m.x, m.y], [closest.x, closest.y]);
      for (let i = 1; i < targets.length; i++) {
        const d = distance([m.x, m.y], [targets[i].x, targets[i].y]);
        if (d < minDist) {
          minDist = d;
          closest = targets[i];
        }
      }

      if (minDist > m.reach) {
        this.moveToward(m, closest.x, closest.y, dt);
      } else if (now >= m.attackReady && MAPS.lineOfSight(m.x, m.y, closest.x, closest.y)) {
        m.attackReady = now + (m.kind === 'golem' || m.kind === 'sentinel' ? 1.6 : 1.2);
        this.addEvent({
          kind: 'monster_attack',
          x: m.x,
          y: m.y,
          tx: closest.x,
          ty: closest.y,
        });
        this.hurtPlayer(closest, m.attack, now);
      }
    }
  }

  moveToward(m: SimMonster, x: number, y: number, dt: number): void {
    const dx = x - m.x;
    const dy = y - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      const nx = dx / d;
      const ny = dy / d;
      const step = Math.min(d, m.speed * dt);
      const [mx, my] = MAPS.move(m.x, m.y, nx * step, ny * step, 17);
      m.x = mx;
      m.y = my;
      m.faceX = nx;
      m.faceY = ny;
    }
  }

  drainEvents(): GameEvent[] {
    const events = this.events.slice(-150);
    this.events = [];
    return events;
  }

  snapshot(now: number, viewer?: SimPlayer, drainedEvents?: GameEvent[]): ServerStateSnapshot {
    const events = drainedEvents ?? this.drainEvents();
    const relevant = viewer
      ? MAPS.relevantZones(viewer.x, viewer.y)
      : Object.keys(MAPS.zones);
    const zoneId = viewer ? MAPS.zoneAt(viewer.x, viewer.y) : 'forest';
    const zone = MAPS.zones[zoneId];
    const joined = Array.from(this.players.values()).filter((p) => p.joined);

    const zoneCounts: Record<string, number> = {};
    for (const zid of Object.keys(MAPS.zones)) {
      zoneCounts[zid] = 0;
    }
    for (const p of joined) {
      const pz = MAPS.zoneAt(p.x, p.y);
      zoneCounts[pz] = (zoneCounts[pz] || 0) + 1;
    }

    return {
      type: 'state',
      serverTime: Number(now.toFixed(3)),
      map: {
        ...zone,
        width: zone.bounds.width,
        height: zone.bounds.height,
      },
      world: {
        width: MAPS.width,
        height: MAPS.height,
        online: joined.length,
        mapCount: 2,
      },
      relevantZones: relevant,
      zoneCounts,
      players: joined
        .filter((p) => relevant.includes(MAPS.zoneAt(p.x, p.y)))
        .map((p) => p.public(now)),
      monsters: this.monsters
        .filter((m) => relevant.includes(MAPS.zoneAt(m.x, m.y)))
        .map((m) => m.public()),
      events: events.filter((e) => !e.zoneId || relevant.includes(e.zoneId)),
    };
  }
}
