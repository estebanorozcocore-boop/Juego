export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ZoneConfig {
  id: string;
  name: string;
  kind: string;
  index: number;
  bounds: Rect;
  spawn: Point;
  assetUrl: string;
  obstacles?: Rect[];
  palette?: {
    ground: string;
    alternate: string;
    path: string;
    accent: string;
  };
  seed?: number;
  description?: string;
  decorations?: Array<{ x: number; y: number; radius?: number; color?: string }>;
}

export interface MapManifest {
  width: number;
  height: number;
  zones: ZoneConfig[];
  connections: Array<{ from: string; via: string; to: string }>;
}

export interface PlayerPublic {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dx: number;
  dy: number;
  basicRemaining: number;
  powerRemaining: number;
  dead: boolean;
  kills: number;
  zoneId: string;
}

export interface MonsterPublic {
  id: string;
  kind: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  detection: number;
  dx: number;
  dy: number;
  dead: boolean;
  zoneId: string;
}

export interface GameEvent {
  kind: 'join' | 'leave' | 'damage' | 'hurt' | 'death' | 'respawn' | 'slash' | 'nova' | 'monster_attack';
  x: number;
  y: number;
  zoneId?: string;
  amount?: number;
  target?: string;
  name?: string;
  dx?: number;
  dy?: number;
  tx?: number;
  ty?: number;
  radius?: number;
  born?: number;
}

export interface ServerStateSnapshot {
  type: 'state';
  serverTime: number;
  map?: ZoneConfig & { width?: number; height?: number };
  world?: {
    width: number;
    height: number;
    online: number;
    mapCount: number;
  };
  relevantZones: string[];
  zoneCounts: Record<string, number>;
  players: PlayerPublic[];
  monsters: MonsterPublic[];
  events: GameEvent[];
}

export interface WelcomeMessage {
  type: 'welcome';
  id: string;
  world: string;
  manifest: MapManifest;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage = ServerStateSnapshot | WelcomeMessage | ErrorMessage;

export interface JoinAction {
  type: 'join';
  name: string;
}

export interface InputAction {
  type: 'input';
  mx: number;
  my: number;
  aimX: number;
  aimY: number;
}

export interface BasicAction {
  type: 'basic';
}

export interface PowerAction {
  type: 'power';
  x: number;
  y: number;
}

export type ClientMessage = JoinAction | InputAction | BasicAction | PowerAction;
