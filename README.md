# UMBRAL — Mundo Continuo

Aplicación React + TypeScript reconstruida a partir del prototipo original de mundo continuo multijugador, preservando toda la física, lógica de combate PvE y diseño visual de mapas interconectados.

## Características

- **Mundo continuo sin salas privadas**: Bosque del Umbral, Paso de las Raíces y Ruinas del Alba conectados en una sola geografía continua (4200 × 1120).
- **Combate y habilidades en tiempo real**: Ataque básico de corte en abanico y habilidad Nova circular con cálculo de línea de visión y enfriamientos.
- **Enemigos procedurales**: Limos, fuegos fatuos, sombras, centinelas y gólems con IA territorial y reaparición en su territorio.
- **Cartografía interactiva y HUD**: Minimapa en vivo con renderizado de exploradores y monstruos, barra de vida, estado de zonas y bitácora de eventos.
- **Controles**:
  - `W A S D`: Moverse
  - `Clic derecho`: Caminar hacia un punto visible
  - `Ratón`: Apuntar
  - `Clic izquierdo` / `Espacio`: Ataque básico (Espadazo)
  - `Q`: Habilidad (Nova circular)

## Desarrollo

```bash
npm install
npm run dev
```

El servidor de desarrollo corre en el puerto 3000 (`http://localhost:3000`).