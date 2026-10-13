import React from 'react';

interface SidePanelProps {
  mapStat: string;
  regionStat: string;
  playersStat: number;
  nearbyStat: number;
  mobsStat: number;
  killsStat: number;
  landscapeStatus: string;
  minimapRef: React.Ref<HTMLCanvasElement>;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  mapStat,
  regionStat,
  playersStat,
  nearbyStat,
  mobsStat,
  killsStat,
  landscapeStatus,
  minimapRef,
}) => {
  return (
    <aside className="side-panel">
      <div className="side-card intel-card">
        <div className="side-header">
          <span>ESTADO DEL MUNDO</span>
          <i className="status-diamond"></i>
        </div>
        <div className="status-grid">
          <div>
            <small>MAPA</small>
            <b id="mapStat">{mapStat}</b>
          </div>
          <div>
            <small>REGIÓN</small>
            <b id="regionStat">{regionStat}</b>
          </div>
        </div>
        <div className="side-rule"></div>
        <div className="stat-row">
          <span>Jugadores en tu zona</span>
          <b id="playersStat">{String(playersStat).padStart(2, '0')}</b>
        </div>
        <div className="stat-row">
          <span>Jugadores cercanos</span>
          <b id="nearbyStat">{String(nearbyStat).padStart(2, '0')}</b>
        </div>
        <div className="stat-row">
          <span>Monstruos cercanos</span>
          <b id="mobsStat">{String(mobsStat).padStart(2, '0')}</b>
        </div>
        <div className="stat-row">
          <span>Monstruos derrotados</span>
          <b id="killsStat">{String(killsStat).padStart(2, '0')}</b>
        </div>
        <div className="landscape-status">
          <span className="green-dot"></span>
          <span id="landscapeStatus">{landscapeStatus}</span>
        </div>
      </div>

      <div className="side-card minimap-card">
        <div className="side-header">
          CARTOGRAFÍA <span className="tiny-meta">NIVEL 0</span>
        </div>
        <canvas
          ref={minimapRef}
          id="minimap"
          width={276}
          height={166}
          aria-label="Minimapa del bosque, el paso y las ruinas"
        ></canvas>
        <div className="legend">
          <span>
            <i className="legend-mark blue"></i> Jugadores
          </span>
          <span>
            <i className="legend-mark amber"></i> Monstruos
          </span>
        </div>
      </div>

      <div className="side-card objective-card">
        <div className="side-header">
          EL SIGUIENTE UMBRAL <span className="objective-index">0.2</span>
        </div>
        <h3>El camino continúa.</h3>
        <p>
          Sigue el sendero hacia el este. El Paso de las Raíces conecta el bosque con las ruinas
          sin detener tu aventura.
        </p>
        <div className="objective-steps">
          <span>
            01 <b>Encuéntrense en el bosque</b>
          </span>
          <span>
            02 <b>Sepárense y crucen el paso</b>
          </span>
          <span>
            03 <b>Reúnanse y sigan combatiendo</b>
          </span>
        </div>
      </div>

      <div className="note-card">
        <i>✦</i>
        <p>
          Tu vida, habilidades y victorias te acompañan. Los centinelas y las sombras aguardan
          entre las ruinas.
        </p>
      </div>
    </aside>
  );
};
