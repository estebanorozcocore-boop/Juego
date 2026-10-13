import React, { useState } from 'react';

interface JoinModalProps {
  initialName: string;
  onJoin: (name: string) => void;
  isLoading: boolean;
  errorMessage: string;
  isGameOver?: boolean;
}

export const JoinModal: React.FC<JoinModalProps> = ({
  initialName,
  onJoin,
  isLoading,
  errorMessage,
  isGameOver = false,
}) => {
  const [name, setName] = useState(initialName || 'Explorador');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = name.trim().slice(0, 18) || 'Explorador';
    onJoin(cleanName);
  };

  return (
    <div id="joinScreen" className="join-screen">
      <div className="join-window">
        <div className="join-emblem">◇</div>
        <div className="join-caption">UMBRAL 0.2 · MAPAS CONECTADOS</div>
        <h1>
          Dos lugares.
          <br />
          <span>Un solo mundo.</span>
        </h1>
        <p>
          Explora el bosque, cruza el desfiladero y descubre las ruinas. Encuentra a otros exploradores
          y sigue combatiendo al otro lado.
        </p>
        <form id="joinForm" onSubmit={handleSubmit}>
          <label htmlFor="nameInput">NOMBRE DEL EXPLORADOR</label>
          <input
            id="nameInput"
            type="text"
            autoComplete="nickname"
            maxLength={18}
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button type="submit" id="joinButton" disabled={isLoading}>
            {isLoading ? 'CONECTANDO…' : isGameOver ? 'VOLVER A ENTRAR' : 'ENTRAR AL MUNDO'}{' '}
            <span>↗</span>
          </button>
        </form>
        <div className="join-foot">
          <span className="green-dot"></span> Mundo compartido <span>·</span> 2 mapas conectados{' '}
          <span>·</span> PvE
        </div>
        {errorMessage && <div id="errorText" className="error-text">{errorMessage}</div>}
      </div>
    </div>
  );
};
