# UMBRAL 0.2 — Dos mapas, un mundo

Bosque y ruinas comparten una única simulación multijugador. Un corredor transitable une ambas zonas: se cruza caminando, con la misma conexión y el mismo personaje.

## Ejecutar

Requiere Python 3.10 o superior y un navegador moderno.

```powershell
python -m pip install -r requirements.txt
python server.py
```

Abre **http://localhost:8000/**. También puedes usar `iniciar_windows.bat`. Para cambiar el puerto en PowerShell, asigna la variable de entorno PORT antes de ejecutar el servidor.

## Recorrido de prueba

1. Abre dos pestañas, entra con nombres diferentes y comprueba que ambos exploradores aparecen en el bosque.
2. Con uno de ellos, sigue el camino hacia el este. La entrada del corredor está en el borde derecho del bosque, entre Y 440 y Y 680; su centro está en Y 560.
3. Cruza el corredor y llega a las ruinas sin cerrar la conexión. El mapa, el minimapa y la región se actualizan durante el recorrido.
4. Deja al primer explorador en las ruinas y mueve al segundo hasta reunirse allí. Comprueba que vuelven a verse y que ambos observan los mismos enemigos y daños.
5. Combate y vuelve al bosque. Cambiar de zona conserva la identidad, la vida, las bajas y los enfriamientos. El tiempo de enfriamiento sigue transcurriendo normalmente y los enemigos pueden infligir daño durante el viaje.

| Control | Acción |
| --- | --- |
| W A S D | Moverse |
| Clic derecho | Caminar hacia un punto visible |
| Ratón | Apuntar |
| Clic izquierdo / Espacio | Espadazo |
| Q | Nova circular |

El clic derecho sigue una línea recta; usa WASD para rodear obstáculos. No hay navegación automática alrededor de pilares.

## Espacio continuo

Todas las posiciones son coordenadas globales. Ningún cambio de zona traslada al personaje a otro punto.

| Zona | Límites | Papel |
| --- | --- | --- |
| Bosque | X 0–1800, Y 0–1120 | Primer mapa y santuario inicial |
| Corredor | X 1800–2400, Y 440–680 | Conexión física y margen para preparar la siguiente zona |
| Ruinas | X 2400–4200, Y 0–1120 | Segundo mapa, geometría y enemigos diferentes |

El servidor impide entrar al vacío que rodea el corredor y atravesar los obstáculos sólidos. Ambos mapas permanecen simulados aunque sus recursos visuales no estén en un cliente.

## Arquitectura

- `map_manager.py`: catálogo de zonas, conexiones, geometría, colisiones y selección de zonas relevantes.
- `server.py`: simulación autoritativa, jugadores, monstruos, combate, WebSocket y rutas de recursos.
- `static/game.js`: entrada del jugador, cámara global, interpolación, carga anticipada y liberación de recursos visuales.
- `static/index.html` y `static/styles.css`: interfaz, región actual, indicadores y minimapa del mundo.
- `tests/`: pruebas de combate, continuidad, colisiones y sincronización entre clientes.

El mensaje de bienvenida incluye un manifiesto compacto del mundo. El cliente solicita la geometría y los parámetros visuales de cada zona a `/maps/<id>.json`, prepara el terreno por fragmentos y anticipa la zona vecina antes de cruzar su frontera. Los recursos lejanos se liberan cuando quedan fuera de la cámara y del margen de retención. Si un recurso tarda, el terreno base sigue visible y el juego continúa.

Cada cliente recibe entidades y efectos de las zonas relevantes para su posición. El contador global de conexiones se envía por separado de las entidades cercanas. Los eventos de combate se capturan una vez por actualización y se distribuyen a todos los observadores relevantes.

## Pruebas

```powershell
python -m unittest discover -s tests -p 'test_*.py' -v
```

Las pruebas de integración abren un servidor aislado en un puerto temporal. El recorrido de dos clientes usa mensajes normales de movimiento, sin agregar controles de teletransporte al juego.

## Alcance de esta versión

- Dos mapas compartidos, conectados por un corredor, en un único servidor.
- Estado del personaje conservado al cambiar de zona y combate PvE autoritativo.
- Recursos visuales procedurales; no se necesitan imágenes descargadas ni servicios externos.
- La muerte mantiene la identidad y permite reaparecer en un santuario; no equivale a cruzar una frontera.
- Estado temporal en memoria: reiniciar el servidor o cerrar la sesión no guarda el progreso.
- Sin cuentas, base de datos, editor de mapas, distribución entre servidores ni despliegue público.
- La carga concurrente máxima no se ha validado. El prototipo es para pruebas locales.

Para probar en otro ordenador de la misma red, usa la IP local del equipo que aloja el servidor y el puerto elegido. El acceso depende de la conectividad y de las reglas de firewall existentes. Un servidor local no demuestra acceso desde Internet.

El siguiente paso queda preparado en el catálogo de zonas y conexiones: un editor que genere esos datos para ampliar el mundo.
