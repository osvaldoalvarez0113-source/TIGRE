# 🐯 TIGRE

Sistema aparte de OVA/ODDX para **leer el movimiento de las líneas** y medir qué señales aciertan.

- **Robot** (`robot/correr.js`, cada 30 min en GitHub Actions): fotografía las cuotas de DraftKings (vía ESPN) —ganador, hándicap, total y props de jugador— y el precio de Kalshi; detecta señales; resuelve las de juegos terminados; mide.
- **Datos**: rama `datos` (la reescribe el robot) y copia diaria en `respaldo`.
- **Página**: `index.html` (GitHub Pages) → https://osvaldoalvarez0113-source.github.io/TIGRE/
- **Avisos**: ntfy, con el secreto `NTFY_TOPIC` del repo.
- **Pruebas**: `node robot/pruebas.js` (corren antes de cada vuelta).

Señales: ⚡ movimiento rápido (2 h), 📈 movimiento desde la apertura, 🔀 Kalshi contra la casa. Umbrales en `robot/config.js`.
Regla de oro: nada de plata real hasta tener 300–500 señales resueltas de un tipo.
