import React from 'react';

interface TopbarProps {
  zoneName: string;
  zoneNumberText: string;
  connected: boolean;
  onlineCount: number;
}

export const Topbar: React.FC<TopbarProps> = ({
  zoneName,
  zoneNumberText,
  connected,
  onlineCount,
}) => {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-glyph">◇</div>
        <div>
          <strong>UMBRAL</strong>
          <small>
            MUNDO CONTINUO <span className="thin">/</span> VERSIÓN 0.2
          </small>
        </div>
      </div>
      <div className="world-indicator">
        <span className="green-dot"></span> SUPERFICIE <span className="slash">/</span>{' '}
        <span id="zoneName">{zoneName}</span>{' '}
        <span className="coordinate" id="zoneNumber">
          {zoneNumberText}
        </span>
      </div>
      <div className="top-right">
        <span id="networkState" className={`connection ${connected ? '' : 'disconnected'}`}>
          <i></i> {connected ? 'CONECTADO' : 'DESCONECTADO'}
        </span>
        <span className="badge" id="onlineCount">
          {onlineCount} EN LÍNEA
        </span>
      </div>
    </header>
  );
};
