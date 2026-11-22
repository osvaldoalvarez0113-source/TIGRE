'use strict';
/* ===================================================================
   TIGRE · ESTUDIO HISTÓRICO DEL MOVIMIENTO DEL GANADOR (moneyline)
   Usa el archivo de cierres que ya junta ODDX (rama «cierres»: apertura y cierre de DraftKings + marcador final)
   para contestar con miles de juegos ya jugados:
     1) ¿Cuánto acierta cada cuota de cierre? (lo que promete contra lo que pasó)
     2) Cuando la línea se mueve de la apertura al cierre, ¿qué hubiera pasado si…
        A) entras TEMPRANO (a la cuota de apertura) al lado que después sube,
        B) sigues el movimiento TARDE (a la cuota de cierre),
        C) vas EN CONTRA del movimiento (al otro lado, a la cuota de cierre)?
   Pura: recibe los juegos y devuelve tablas. La usa robot/correr.js una vez al día.
   =================================================================== */
const { sinMargen, ganancia } = require('./lib.js');

const TRAMOS_MOV = [[0, 2, 'menos de 2 pts'], [2, 4, '2 a 4 pts'], [4, 7, '4 a 7 pts'], [7, 101, '7 pts o más']];
const TRAMOS_P = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 0.75], [0.75, 0.8], [0.8, 1.01]];

function nuevo() { return { n: 0, g: 0, p: 0, pA: 0, rA: 0, rB: 0, rC: 0 }; }
function cerrar(x) {
  if (!x.n) return null;
  const r = v => +(v / x.n * 100).toFixed(1);
  return { n: x.n, gana: r(x.g), prometeCierre: r(x.p), prometeApertura: r(x.pA), roiTemprano: r(x.rA), roiTarde: r(x.rB), roiContra: r(x.rC) };
}
/* margen de error aproximado (95%) de un % de aciertos con n juegos, en puntos */
function margen(p, n) { return n ? +(196 * Math.sqrt(p * (1 - p) / n)).toFixed(1) : null; }

/* juegos: [{dep, ml:[local, visita], mlOpen:[local, visita], hs, as}] */
function estudiar(juegos) {
  const porDep = {}, total = { mov: TRAMOS_MOV.map(nuevo), cal: TRAMOS_P.map(() => ({ n: 0, g: 0, p: 0 })), n: 0, desde: null, hasta: null };
  juegos.forEach(j => {
    if (!j.ml || j.hs === j.as || j.hs == null || j.as == null) return;
    const pc = sinMargen(j.ml); if (!pc) return;
    const ganaLocal = j.hs > j.as;
    const D = porDep[j.dep] = porDep[j.dep] || { mov: TRAMOS_MOV.map(nuevo), cal: TRAMOS_P.map(() => ({ n: 0, g: 0, p: 0 })), n: 0 };
    [D, total].forEach(X => {
      X.n++;
      /* calibración del cierre: el favorito de cierre */
      const fav = pc[0] >= pc[1] ? 0 : 1, pf = pc[fav];
      const k = TRAMOS_P.findIndex(t => pf >= t[0] && pf < t[1]);
      if (k >= 0) { const c = X.cal[k]; c.n++; c.p += pf; if ((fav === 0) === ganaLocal) c.g++; }
    });
    if (j.ts) { total.desde = Math.min(total.desde || j.ts, j.ts); total.hasta = Math.max(total.hasta || 0, j.ts); }
    if (!j.mlOpen) return;
    const po = sinMargen(j.mlOpen); if (!po) return;
    const d = (pc[0] - po[0]) * 100, sube = d >= 0 ? 0 : 1, otro = 1 - sube, mag = Math.abs(d);
    const k = TRAMOS_MOV.findIndex(t => mag >= t[0] && mag < t[1]);
    const gs = (sube === 0) === ganaLocal;
    [D, total].forEach(X => {
      const m = X.mov[k]; m.n++; if (gs) m.g++; m.p += pc[sube]; m.pA += po[sube];
      m.rA += ganancia(j.mlOpen[sube], gs ? 'gana' : 'pierde');
      m.rB += ganancia(j.ml[sube], gs ? 'gana' : 'pierde');
      m.rC += ganancia(j.ml[otro], gs ? 'pierde' : 'gana');
    });
  });
  const salida = X => ({
    juegos: X.n,
    movimiento: TRAMOS_MOV.map((t, i) => Object.assign({ tramo: t[2] }, cerrar(X.mov[i]) || { n: 0 })),
    calibracion: TRAMOS_P.map((t, i) => { const c = X.cal[i]; return { tramo: Math.round(t[0] * 100) + (t[1] > 1 ? '%+' : '–' + Math.round(t[1] * 100) + '%'), n: c.n, promete: c.n ? +(c.p / c.n * 100).toFixed(1) : null, gana: c.n ? +(c.g / c.n * 100).toFixed(1) : null, margen: c.n ? margen(c.g / c.n, c.n) : null }; })
  });
  const out = { todos: salida(total), deportes: {} };
  Object.keys(porDep).forEach(d => { out.deportes[d] = salida(porDep[d]); });
  out.desde = total.desde; out.hasta = total.hasta;
  return out;
}

/* archivo de la rama cierres de ODDX → lista para estudiar() */
function juegosDeCierres(dep, arch) {
  const out = [];
  Object.values((arch && arch.temps) || {}).forEach(t => (t.juegos || []).forEach(g => {
    if (!g.done || g.skip || !g.linea || !g.linea.ml) return;
    out.push({ dep, ts: g.ts, ml: g.linea.ml, mlOpen: g.linea.mlOpen || null, hs: g.hs, as: g.as });
  }));
  return out;
}

module.exports = { estudiar, juegosDeCierres, margen, TRAMOS_MOV, TRAMOS_P };
