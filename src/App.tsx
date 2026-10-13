import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Topbar } from './components/Topbar';
import { SidePanel } from './components/SidePanel';
import { JoinModal } from './components/JoinModal';
import { Footer } from './components/Footer';
import { WorldRenderer } from './game/worldRenderer';
import { WorldSimulation } from './game/worldSimulation';
import { MAPS } from './game/mapManager';
import {
  ClientMessage,
  GameEvent,
  PlayerPublic,
  ServerMessage,
  ServerStateSnapshot,
} from './types/game';

interface FeedItem {
  id: string;
  text: string;
}

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);

  // Connection & Game State
  const [joined, setJoined] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem('umbral_name') || 'Explorador';
    } catch {
      return 'Explorador';
    }
  });
  const [connected, setConnected] = useState(false);

  // HUD and Stats State
  const [zoneName, setZoneName] = useState('BOSQUE DEL UMBRAL');
  const [zoneNumberText, setZoneNumberText] = useState('ZONA 01');
  const [mapStat, setMapStat] = useState('01 / 02');
  const [regionStat, setRegionStat] = useState('BOSQUE');
  const [travelHint, setTravelHint] = useState('Sigue el sendero al este → Ruinas');
  const [posReadout, setPosReadout] = useState('X 0000 · Y 0000');
  const [onlineCount, setOnlineCount] = useState(1);
  const [playersInZone, setPlayersInZone] = useState(1);
  const [nearbyPlayers, setNearbyPlayers] = useState(1);
  const [nearbyMobs, setNearbyMobs] = useState(0);
  const [killsCount, setKillsCount] = useState(0);
  const [playerHp, setPlayerHp] = useState(100);
  const [playerMaxHp] = useState(100);
  const [isDead, setIsDead] = useState(false);
  const [landscapeStatus, setLandscapeStatus] = useState('Preparando el camino…');
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);

  // Cooldowns
  const [basicCooldownPct, setBasicCooldownPct] = useState(0);
  const [powerCooldownPct, setPowerCooldownPct] = useState(0);

  // Refs for low-latency game loop
  const socketRef = useRef<WebSocket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const localSimRef = useRef<WorldSimulation | null>(null);
  const isLocalModeRef = useRef<boolean>(false);
  const rendererRef = useRef<WorldRenderer>(new WorldRenderer());
  const stateRef = useRef<ServerStateSnapshot>({
    type: 'state',
    serverTime: 0,
    relevantZones: ['forest'],
    zoneCounts: { forest: 1, corridor: 0, ruins: 0 },
    players: [],
    monsters: [],
    events: [],
  });

  const cameraRef = useRef<{ x: number; y: number }>({ x: 0, y: 275 });
  const viewportRef = useRef<{ w: number; h: number; dpr: number }>({ w: 960, h: 570, dpr: 1 });
  const keysRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<{ x: number; y: number; worldX: number; worldY: number }>({
    x: 400,
    y: 300,
    worldX: 400,
    worldY: 300,
  });
  const myRenderRef = useRef<{ x: number; y: number }>({ x: 295, y: 580 });
  const walkRouteRef = useRef<Array<{ x: number; y: number }>>([]);
  const walkTargetRef = useRef<{ x: number; y: number } | null>(null);
  const cdRef = useRef<{ basic: number; power: number }>({ basic: 0, power: 0 });
  const effectsRef = useRef<GameEvent[]>([]);
  const currentZoneIdRef = useRef<string>('forest');
  const lastZoneIdRef = useRef<string>('');

  const addFeed = useCallback((text: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setFeedItems((prev) => [...prev.slice(-3), { id, text }]);
    setTimeout(() => {
      setFeedItems((prev) => prev.filter((item) => item.id !== id));
    }, 4100);
  }, []);

  // Send message to server or local simulation
  const sendMessage = useCallback((msg: ClientMessage) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(msg));
    } else if (isLocalModeRef.current && localSimRef.current && myIdRef.current) {
      const p = localSimRef.current.players.get(myIdRef.current);
      if (p) {
        localSimRef.current.handleAction(p, msg);
      }
    }
  }, []);

  // Handle server/sim messages
  const handleMessage = useCallback((message: ServerMessage) => {
    if (message.type === 'welcome') {
      myIdRef.current = message.id;
      setJoined(true);
      setConnecting(false);
      rendererRef.current.setManifest(message.manifest);
      effectsRef.current = [];
      walkRouteRef.current = [];
      walkTargetRef.current = null;
      addFeed('Has entrado al mundo continuo');
    } else if (message.type === 'state') {
      stateRef.current = message;
      const myId = myIdRef.current;
      const p = message.players.find((pl) => pl.id === myId);

      if (p) {
        cdRef.current.basic = performance.now() + p.basicRemaining * 1000;
        cdRef.current.power = performance.now() + p.powerRemaining * 1000;
        setPlayerHp(p.hp);
        setIsDead(p.dead);
        setKillsCount(p.kills);
      }

      setOnlineCount(message.world?.online ?? message.players.length);
      const activeZone = message.map?.id || (p && MAPS.zoneAt(p.x, p.y)) || 'forest';
      setPlayersInZone(message.zoneCounts?.[activeZone] ?? message.players.length);
      setNearbyPlayers(message.players.length);
      setNearbyMobs(message.monsters.filter((m) => !m.dead).length);

      if (p && activeZone !== lastZoneIdRef.current) {
        lastZoneIdRef.current = activeZone;
        currentZoneIdRef.current = activeZone;
        const zObj = MAPS.zones[activeZone];
        if (zObj) {
          setZoneName(zObj.name.toUpperCase());
          setZoneNumberText(
            activeZone === 'corridor' ? 'CONEXIÓN' : `ZONA ${String(zObj.index || 1).padStart(2, '0')}`
          );
          setMapStat(activeZone === 'corridor' ? 'PASO' : `${String(zObj.index || 1).padStart(2, '0')} / 02`);
          setRegionStat(
            activeZone === 'ruins' ? 'RUINAS' : activeZone === 'forest' ? 'BOSQUE' : 'DESFILADERO'
          );
          setTravelHint(
            activeZone === 'forest'
              ? 'Sigue el sendero al este → Ruinas'
              : activeZone === 'ruins'
              ? '← Bosque · Explora las ruinas'
              : '← Bosque · Paso de las Raíces · Ruinas →'
          );
          addFeed(zObj.name);
        }
      }

      for (const ev of message.events || []) {
        effectsRef.current.push({ ...ev, born: performance.now() });
        if (ev.kind === 'join' && ev.name && ev.name !== playerName) {
          addFeed(`${ev.name} ha llegado al mundo`);
        }
        if (ev.kind === 'leave' && ev.name) {
          addFeed(`${ev.name} salió del mundo`);
        }
      }
    } else if (message.type === 'error') {
      setErrorText(message.message);
      setConnecting(false);
    }
  }, [addFeed, playerName]);

  // Connect flow
  const handleJoin = useCallback((name: string) => {
    setPlayerName(name);
    try {
      localStorage.setItem('umbral_name', name);
    } catch {
      // ignore
    }
    setConnecting(true);
    setErrorText('');

    // Attempt WebSocket connection
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;

    let ws: WebSocket | null = null;
    let didConnect = false;

    try {
      ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      const connectionTimeout = setTimeout(() => {
        if (!didConnect) {
          // If websocket cannot connect within 1.5s, gracefully switch to local simulation
          if (ws) ws.close();
          initLocalSimulation(name);
        }
      }, 1500);

      ws.onopen = () => {
        didConnect = true;
        clearTimeout(connectionTimeout);
        setConnected(true);
        ws?.send(JSON.stringify({ type: 'join', name }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        if (!didConnect) {
          clearTimeout(connectionTimeout);
          initLocalSimulation(name);
        }
      };

      ws.onclose = () => {
        if (didConnect) {
          setConnected(false);
          setJoined(false);
          setErrorText('La conexión terminó. Puedes volver a entrar.');
        }
      };
    } catch {
      initLocalSimulation(name);
    }

    function initLocalSimulation(userName: string) {
      isLocalModeRef.current = true;
      const sim = new WorldSimulation();
      localSimRef.current = sim;

      // Spawn companion explorer so the user can experience the multiplayer feel!
      const companion = sim.spawnPlayer('Centinela-Aliado');
      companion.x = 340;
      companion.y = 610;

      const player = sim.spawnPlayer(userName);
      myIdRef.current = player.id;
      myRenderRef.current = { x: player.x, y: player.y };

      setConnected(true);
      setJoined(true);
      setConnecting(false);
      addFeed('Has entrado al mundo continuo');
      rendererRef.current.setManifest(MAPS.manifest());
    }
  }, [handleMessage, addFeed]);

  // Input sync ticker (every 50ms)
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      const keys = keysRef.current;
      const myId = myIdRef.current;
      const state = stateRef.current;
      const p = state.players.find((pl) => pl.id === myId);

      let mx = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      let my = (keys.has('s') ? 1 : 0) - (keys.has('w') ? 1 : 0);

      if (!mx && !my && walkTargetRef.current && p) {
        const dx = walkTargetRef.current.x - p.x;
        const dy = walkTargetRef.current.y - p.y;
        const dd = Math.hypot(dx, dy);
        if (dd > 13) {
          mx = dx / dd;
          my = dy / dd;
        } else {
          walkTargetRef.current = walkRouteRef.current.shift() || null;
        }
      }

      sendMessage({
        type: 'input',
        mx,
        my,
        aimX: pointerRef.current.worldX,
        aimY: pointerRef.current.worldY,
      });
    }, 50);

    return () => clearInterval(interval);
  }, [joined, sendMessage]);

  // Local simulation tick loop (30Hz tick, 15Hz broadcast)
  useEffect(() => {
    if (!joined || !isLocalModeRef.current) return;
    const sim = localSimRef.current;
    if (!sim) return;

    let prevTime = performance.now();
    let nextBroadcast = prevTime;

    const interval = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - prevTime) / 1000, 0.1);
      prevTime = now;
      const simNow = (now - sim.startTime) / 1000;
      sim.tick(dt, simNow);

      if (now >= nextBroadcast) {
        nextBroadcast = now + 1000 / 15;
        const myP = myIdRef.current ? sim.players.get(myIdRef.current) : undefined;
        const snapshot = sim.snapshot(simNow, myP);
        handleMessage(snapshot);
      }
    }, 1000 / 30);

    return () => clearInterval(interval);
  }, [joined, handleMessage]);

  // Keyboard events
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'q'].includes(k)) {
        e.preventDefault();
      }
      keysRef.current.add(k);
      if (!joined || e.repeat) return;
      if (k === 'q') {
        sendMessage({
          type: 'power',
          x: pointerRef.current.worldX,
          y: pointerRef.current.worldY,
        });
      }
      if (k === ' ') {
        sendMessage({ type: 'basic' });
      }
      if ('wasd'.includes(k) && k.length === 1) {
        walkTargetRef.current = null;
        walkRouteRef.current = [];
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };

    const handleBlur = () => {
      keysRef.current.clear();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [joined, sendMessage]);

  // Canvas Resize Observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      viewportRef.current = {
        w: bounds.width,
        h: bounds.height,
        dpr,
      };
      canvas.width = Math.round(bounds.width * dpr);
      canvas.height = Math.round(bounds.height * dpr);
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(canvas);
    handleResize();

    return () => ro.disconnect();
  }, []);

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const minimap = minimapRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const mtx = minimap ? minimap.getContext('2d') : null;
    let animId: number;
    let lastStreamCheck = 0;

    const render = (time: number) => {
      const myId = myIdRef.current;
      const state = stateRef.current;
      const me = state.players.find((p) => p.id === myId);
      const viewport = viewportRef.current;
      const camera = cameraRef.current;
      const worldW = MAPS.width;
      const worldH = MAPS.height;

      if (me) {
        if (!Number.isFinite(myRenderRef.current.x)) {
          myRenderRef.current = { x: me.x, y: me.y };
        }
        myRenderRef.current.x += (me.x - myRenderRef.current.x) * 0.16;
        myRenderRef.current.y += (me.y - myRenderRef.current.y) * 0.16;

        camera.x = Math.max(0, Math.min(worldW - viewport.w, myRenderRef.current.x - viewport.w * 0.49));
        camera.y = Math.max(0, Math.min(worldH - viewport.h, myRenderRef.current.y - viewport.h * 0.49));

        setPosReadout(`X ${String(Math.round(me.x)).padStart(4, '0')} · Y ${String(Math.round(me.y)).padStart(4, '0')}`);
      } else {
        camera.x = 0;
        camera.y = 275;
      }

      pointerRef.current.worldX = pointerRef.current.x + camera.x;
      pointerRef.current.worldY = pointerRef.current.y + camera.y;

      if (ctx) {
        ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
        ctx.clearRect(0, 0, viewport.w, viewport.h);
        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        if (time - lastStreamCheck > 150) {
          rendererRef.current.updateResources(me || { x: 295, y: 580 }, camera, viewport);
          lastStreamCheck = time;
          const readyCount = Array.from(rendererRef.current.resources.values()).filter((r) => r.status === 'ready').length;
          setLandscapeStatus(`${readyCount} ${readyCount === 1 ? 'zona preparada' : 'zonas preparadas'}`);
        }

        rendererRef.current.drawWorld(ctx, camera, viewport, time);

        // Draw Monsters
        for (const m of state.monsters) {
          rendererRef.current.drawMonster(ctx, m, me, camera, viewport, time);
        }

        // Draw Players
        for (const person of state.players) {
          rendererRef.current.drawPlayer(ctx, person, myId, camera, viewport);
        }

        // Draw Effects
        effectsRef.current = effectsRef.current.filter((ev) => {
          const born = ev.born || time;
          const maxAge = ev.kind === 'nova' ? 740 : ev.kind === 'join' || ev.kind === 'respawn' ? 1050 : 850;
          return time - born < maxAge;
        });
        rendererRef.current.drawEffects(ctx, effectsRef.current, time);

        // Draw Pointer Crosshair
        if (joined) {
          ctx.save();
          ctx.translate(pointerRef.current.worldX, pointerRef.current.worldY);
          ctx.strokeStyle = '#e8ead2aa';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(0, 0, 12, 0, 7);
          ctx.moveTo(-20, 0);
          ctx.lineTo(-8, 0);
          ctx.moveTo(8, 0);
          ctx.lineTo(20, 0);
          ctx.moveTo(0, -20);
          ctx.lineTo(0, -8);
          ctx.moveTo(0, 8);
          ctx.lineTo(0, 20);
          ctx.stroke();
          ctx.restore();

          if (walkTargetRef.current) {
            ctx.beginPath();
            ctx.arc(walkTargetRef.current.x, walkTargetRef.current.y, 13, 0, 7);
            ctx.strokeStyle = '#b3e2a5';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }

        ctx.restore();
      }

      // Draw Minimap
      if (mtx && minimap) {
        rendererRef.current.drawMinimap(
          mtx,
          minimap.width,
          minimap.height,
          state.players,
          state.monsters,
          myId,
          currentZoneIdRef.current,
          camera,
          viewport,
          state.zoneCounts || {}
        );
      }

      // Update cooldown UI bars
      const pp = Math.max(0, (cdRef.current.power - time) / 1000);
      const bb = Math.max(0, (cdRef.current.basic - time) / 1000);
      setPowerCooldownPct(Math.round(100 * (1 - Math.min(1, pp / 3.4))));
      setBasicCooldownPct(Math.round(100 * (1 - Math.min(1, bb / 0.48))));

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [joined]);

  // Pointer position update
  const updatePointer = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const box = canvas.getBoundingClientRect();
    pointerRef.current.x = e.clientX - box.left;
    pointerRef.current.y = e.clientY - box.top;
    pointerRef.current.worldX = pointerRef.current.x + cameraRef.current.x;
    pointerRef.current.worldY = pointerRef.current.y + cameraRef.current.y;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!joined) return;
    e.preventDefault();
    updatePointer(e);

    if (e.button === 0) {
      sendMessage({ type: 'basic' });
    } else if (e.button === 2) {
      const target = { x: pointerRef.current.worldX, y: pointerRef.current.worldY };
      const myId = myIdRef.current;
      const me = stateRef.current.players.find((pl) => pl.id === myId);
      if (!me) return;

      const fromZone = MAPS.zoneAt(me.x, me.y);
      const toZone = MAPS.zoneAt(target.x, target.y);

      walkRouteRef.current = [];
      if (fromZone !== toZone) {
        const east = target.x > me.x;
        if (fromZone !== 'corridor') {
          walkRouteRef.current.push({ x: east ? 1755 : 2445, y: 560 });
        }
        if (toZone !== 'corridor') {
          walkRouteRef.current.push({ x: east ? 2445 : 1755, y: 560 });
        }
      }
      walkRouteRef.current.push(target);
      walkTargetRef.current = walkRouteRef.current.shift() || null;
    }
  };

  const triggerBasicAbility = () => {
    if (!joined) return;
    sendMessage({ type: 'basic' });
  };

  const triggerPowerAbility = () => {
    if (!joined) return;
    sendMessage({
      type: 'power',
      x: pointerRef.current.worldX,
      y: pointerRef.current.worldY,
    });
  };

  return (
    <div className="app-shell">
      <Topbar
        zoneName={zoneName}
        zoneNumberText={zoneNumberText}
        connected={connected}
        onlineCount={onlineCount}
      />

      <main className="workspace">
        <section className="game-panel">
          <div className="panel-header">
            <span>
              <i className="tiny-cross"></i> MUNDO COMPARTIDO <em>• SIN SALAS PRIVADAS</em>
            </span>
            <span id="posReadout">{posReadout}</span>
          </div>

          <div className="canvas-wrap" ref={canvasWrapRef} id="canvasWrap">
            <canvas
              ref={canvasRef}
              id="game"
              aria-label="Mapa multijugador interactivo"
              onMouseMove={updatePointer}
              onMouseDown={handleMouseDown}
              onContextMenu={(e) => e.preventDefault()}
            />

            <div className="canvas-top">
              <span className="area-label">
                <span className="tiny-square"></span> <span id="areaName">{zoneName}</span>
              </span>
              <span className="demo-tag">DOS MAPAS · UN MUNDO</span>
            </div>

            <div className="travel-hint" id="travelHint">
              {travelHint}
            </div>

            <div className="floating-feed" id="feed" aria-live="polite">
              {feedItems.map((item) => (
                <div key={item.id} className="feed-line">
                  {item.text}
                </div>
              ))}
            </div>

            <div className="canvas-bottom">
              <div className="player-portrait">
                <span>◈</span>
              </div>
              <div className="player-hud">
                <div className="player-name">
                  <b id="playerName">{playerName.toUpperCase()}</b>
                  <small>NIVEL DE PRUEBA 01</small>
                </div>
                <div className="hp-track">
                  <div
                    id="hpFill"
                    className="hp-fill"
                    style={{ width: `${Math.round((playerHp / playerMaxHp) * 100)}%` }}
                  />
                  <span id="hpText">{`${playerHp} / ${playerMaxHp} HP`}</span>
                </div>
              </div>

              <div className="ability" onClick={triggerBasicAbility} title="Ataque básico (Clic / Espacio)">
                <span className="keycap">CLIC</span>
                <b>ATAQUE</b>
                <small>Espadazo</small>
                <div
                  id="basicOverlay"
                  className="cooldown-overlay"
                  style={{ transform: `translateY(${basicCooldownPct}%)` }}
                />
              </div>

              <div
                className="ability accent"
                onClick={triggerPowerAbility}
                title="Habilidad Nova circular (Q)"
              >
                <span className="keycap">Q</span>
                <b>HABILIDAD</b>
                <small>Nova circular</small>
                <div
                  id="powerOverlay"
                  className="cooldown-overlay"
                  style={{ transform: `translateY(${powerCooldownPct}%)` }}
                />
              </div>
            </div>

            {isDead && (
              <div id="deathBanner" className="death-banner">
                <strong>HAS CAÍDO</strong>
                <span>Reaparecerás en el santuario…</span>
              </div>
            )}

            {!joined && (
              <JoinModal
                initialName={playerName}
                onJoin={handleJoin}
                isLoading={connecting}
                errorMessage={errorText}
              />
            )}
          </div>

          <Footer />
        </section>

        <SidePanel
          mapStat={mapStat}
          regionStat={regionStat}
          playersStat={playersInZone}
          nearbyStat={nearbyPlayers}
          mobsStat={nearbyMobs}
          killsStat={killsCount}
          landscapeStatus={landscapeStatus}
          minimapRef={minimapRef}
        />
      </main>
    </div>
  );
};

export default App;
