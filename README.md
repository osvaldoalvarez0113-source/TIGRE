# 🐯 TIGRE

Sistema aparte de OVA/ODDX para **leer el movimiento de las líneas** y medir qué señales aciertan.

- **Robot** (`robot/correr.js`, cada 10 min, disparado por cron-job.org; GitHub cada hora de respaldo): fotografía las cuotas de DraftKings (vía ESPN) —ganador, hándicap, total y props de jugador— y el precio de Kalshi; detecta señales; resuelve las de juegos terminados; mide.
- **Datos**: rama `datos` (la reescribe el robot) y copia diaria en `respaldo`.
- **Página**: `index.html` (GitHub Pages) → https://osvaldoalvarez0113-source.github.io/TIGRE/
- **Avisos**: ntfy, con el secreto `NTFY_TOPIC` del repo.
- **Pruebas**: `node robot/pruebas.js` (corren antes de cada vuelta).

Tenis: ATP, WTA, Challenger y Copa Davis con Kalshi como fuente (ESPN no trae cuotas de tenis).
Señales: ⚡ movimiento rápido (2 h), 📈 movimiento desde la apertura, 🔀 Kalshi contra la casa. Umbrales en `robot/config.js`.
Regla de oro: nada de plata real hasta tener 300–500 señales resueltas de un tipo.
