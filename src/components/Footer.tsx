import React from 'react';

export const Footer: React.FC = () => {
  return (
    <>
      <div className="game-footer">
        <span>
          <b>W A S D</b> Moverse
        </span>
        <span>
          <b>CLIC DERECHO</b> Ir al punto
        </span>
        <span>
          <b>CLIC IZQ. / ESPACIO</b> Ataque
        </span>
        <span>
          <b>Q</b> Poder
        </span>
        <span className="footer-tip">Apunta con el ratón</span>
      </div>
      <footer className="page-footer">
        <span>UMBRAL / MUNDO CONTINUO</span>
        <span>Una sola geografía. Infinitas posibilidades.</span>
        <span>BUILD 0.2.0</span>
      </footer>
    </>
  );
};
