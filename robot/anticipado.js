'use strict';
/* ===================================================================
   TIGRE · PICK ANTICIPADO (puro, sin red)

   La idea de Osvaldo: no perseguir la línea cuando ya se movió, sino ADELANTARSE.
   El robot congela un pick una sola vez, temprano, con su precio:
     • ganador, hándicap y total: el lado con más fuerza en la ficha, un día antes (entre 26 y 3 horas antes;
       si la línea sale más tarde, apenas sale)
     • props: el favorito (el lado que la casa ve más probable) apenas sale la línea (2+ horas antes)
   Después se mide: aciertos, rendimiento al precio temprano, el MISMO pick jugado al cierre,
   y si la línea terminó a favor (CLV). Así se sabe si adelantarse consigue mejores líneas y más aciertos.
   =================================================================== */
const R = require('./registro.js');
const Z = require('./fuerza.js');

const HORA = 36e5;
const VENTANA = { max: 26, min: 3, propMin: 2 };      /* horas antes del juego */

/* picks nuevos de un juego (los que todavía no se congelaron). ya = Set de ids ya congelados */
function congelar(j, ahora, ya) {
  const out = [];
  if (j.st !== 'pre' || j.cancel || !(j.ts > ahora)) return out;
  const horas = (j.ts - ahora) / HORA;
  const base = mk => ({ id: j.id + '|' + mk, t: ahora, dep: j.dep, liga: j.liga, jid: j.id, ts: j.ts, horas: +horas.toFixed(1),
    partido: j.dep === 'tenis' ? j.h.n + ' vs ' + j.a.n : j.a.ab + ' @ ' + j.h.ab, mk });
  /* ganador, hándicap y total: el lado con más fuerza */
  if (horas <= VENTANA.max && horas >= VENTANA.min && j.ficha) {
    ['ml', 'sp', 'tot'].forEach(mk => {
      const f = j.ficha[mk], m = j.m[mk]; if (!f || !m || ya.has(j.id + '|' + mk)) return;
      const u = R.ultima(m), p = u && R.probs(m.t, u.c); if (!p || p[f.lado] == null) return;
      const l = R.lineaLado(m.t, u.l, f.lado);
      out.push(Object.assign(base(mk), { tipo: 'ficha', mt: m.t, lado: f.lado, c: u.c[f.lado], p: +p[f.lado].toFixed(4), l,
        txt: R.etiqueta(j, mk, f.lado, u.l), fz: Z.resumen(f) }));
    });
  }
  /* props: el favorito apenas sale */
  if (horas >= VENTANA.propMin) {
    Object.keys(j.m).forEach(mk => {
      const m = j.m[mk]; if (m.t !== 'prop' || ya.has(j.id + '|' + mk)) return;
      if (!m.serie.length || ahora - m.serie[0][0] > 20 * 60e3) return;     /* solo si la línea acaba de salir (la primera foto) */
      const u = R.ultima(m), p = u && R.probs('prop', u.c); if (!p) return;
      const lado = p[0] >= p[1] ? 0 : 1;
      out.push(Object.assign(base(mk), { tipo: 'propFav', mt: 'prop', lado, c: u.c[lado], p: +p[lado].toFixed(4), l: u.l,
        txt: R.etiqueta(j, mk, lado, u.l), ath: m.ath, k: m.k }));
    });
  }
  return out;
}

module.exports = { VENTANA, congelar };
