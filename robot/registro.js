'use strict';
/* ===================================================================
   TIGRE · REGISTRO DE LÍNEAS Y DETECTOR DE SEÑALES (puro, sin red)

   Cada juego guarda, por mercado, la apertura de la casa y una serie con cada cambio que vio el robot:
     j.m[clave] = { t: 'ml'|'sp'|'tot'|'prop'|'k', abre: {c, l, t}, serie: [[t, c, l], ...], visto: t }
       ml   c = [local, visita] o [local, empate, visita] (cuotas americanas)
       sp   c = [local, visita], l = línea del LOCAL (−4.5 = el local da 4.5)
       tot  c = [más, menos], l = total
       prop c = [más, menos], l = línea; además ath (atleta), k (estadística), n (nombre)
       k    c = [centavos local, centavos visita] de Kalshi (punto medio entre compra y venta)
   j.cierre[clave] = última foto antes de empezar el juego ({c, l, t}).
   =================================================================== */
const { sinMargen, amTxt } = require('./lib.js');
const C = require('./config.js');

const HORA = 36e5;

function nuevoJuego(ev, liga) {
  return { id: ev.id, dep: ev.dep, liga, ts: ev.ts, st: ev.st, det: ev.det, fin: ev.fin, h: ev.h, a: ev.a, hs: ev.hs, as: ev.as, m: {} };
}
function actualizarMeta(j, ev) {
  ['ts', 'st', 'det', 'fin', 'h', 'a', 'hs', 'as', 'cancel'].forEach(k => { if (ev[k] !== undefined) j[k] = ev[k]; });
}
const igual = (x, y) => JSON.stringify(x) === JSON.stringify(y);
/* anota una foto de un mercado; solo agrega a la serie si cambió algo */
function anotar(j, clave, tipo, ahora, val, abre, extra) {
  let m = j.m[clave];
  if (!m) { m = j.m[clave] = { t: tipo, serie: [] }; if (extra) Object.assign(m, extra); }
  if (abre && !m.abre) m.abre = { c: abre.c, l: abre.l === undefined ? null : abre.l };
  const l = val.l === undefined ? null : val.l, ult = m.serie[m.serie.length - 1];
  if (!ult || !igual(ult[1], val.c) || ult[2] !== l) m.serie.push([ahora, val.c, l]);
  m.visto = ahora;
  return m;
}
/* probabilidades (sin margen) de una foto; Kalshi: centavos normalizados */
function probs(tipo, c) {
  if (!c) return null;
  if (tipo === 'k') { const s = c[0] + c[1]; return s > 0 ? [c[0] / s, c[1] / s] : null; }
  return sinMargen(c);
}
/* la foto vigente en el instante t (la última anotada antes o en t) */
function valorEn(serie, t) { let v = null; for (const e of serie) { if (e[0] <= t) v = e; else break; } return v; }
const foto = e => (e ? { t: e[0], c: e[1], l: e[2] } : null);
function ultima(m) { return m && m.serie.length ? foto(m.serie[m.serie.length - 1]) : null; }

/* al empezar el juego: guarda la última foto previa de cada mercado como cierre */
function fijarCierre(j) {
  if (j.cierre) return false;
  j.cierre = {};
  Object.keys(j.m).forEach(k => { const v = valorEn(j.m[k].serie, j.ts + 5 * 60e3); if (v) j.cierre[k] = { c: v[1], l: v[2], t: v[0] }; });
  return true;
}

/* línea de un lado: hándicap del visitante = −línea del local; total y props: la misma para los dos lados */
function lineaLado(tipo, l, lado) { if (l === null || l === undefined) return null; return tipo === 'sp' && lado === 1 ? -l : l; }

/* nombre del lado para mostrar */
function etiqueta(j, clave, lado, l) {
  const m = j.m[clave]; if (!m) return '';
  const f = v => (v > 0 ? '+' : '') + v;
  if (m.t === 'ml' || m.t === 'k') {
    const tres = m.serie[0] && m.serie[0][1].length === 3;
    if (tres) return lado === 1 ? 'Empate' : [j.h.n, null, j.a.n][lado] + ' gana';
    return [j.h.n, j.a.n][lado] + ' gana';
  }
  if (m.t === 'sp') return [j.h.n, j.a.n][lado] + ' ' + f(lineaLado('sp', l, lado));
  if (m.t === 'tot') return (lado === 0 ? 'Más de ' : 'Menos de ') + l;
  if (m.t === 'prop') { const T = (C.PROPS[j.dep] || []).find(x => x.k === m.k); return (m.n || 'Jugador') + ' · ' + (lado === 0 ? 'Más de ' : 'Menos de ') + l + ' ' + (T ? T.n.toLowerCase() : m.k); }
  return clave;
}
function cuotaTxt(tipo, c, lado) { if (!c) return '—'; if (tipo === 'k') return Math.round(c[lado]) + '¢'; const v = c[lado]; return (v > 0 ? '+' : '') + v; }

/* ---------- movimiento entre dos fotos de un mercado ----------
   Devuelve {lado, mag, unidad:'pts'|'línea'} del lado hacia el que se movió el mercado, o null. */
function movimiento(tipo, ref, ahora, U, cual) {
  if (!ref || !ahora) return null;
  const pr = probs(tipo, ref.c), pa = probs(tipo, ahora.c);
  const porPrecio = umbral => {
    if (!pr || !pa || pr.length !== pa.length) return null;
    let mejor = null; pa.forEach((p, i) => { const d = (p - pr[i]) * 100; if (!mejor || d > mejor.mag) mejor = { lado: i, mag: d }; });
    return mejor && mejor.mag >= umbral ? { lado: mejor.lado, mag: +mejor.mag.toFixed(1), unidad: 'pts' } : null;
  };
  if (tipo === 'ml') return porPrecio(U.ml[cual]);
  if (tipo === 'sp' || tipo === 'tot' || tipo === 'prop') {
    const lr = ref.l, la = ahora.l; if (lr === null || la === null) return null;
    const ul = tipo === 'prop' ? U.prop.linea : U[tipo][cual], up = tipo === 'prop' ? U.prop.precio : U.precio;
    if (tipo === 'sp' && U.sp.fijo && lr !== la && Math.abs(lr) === Math.abs(la)) return null;   /* solo cambió el favorito (±1.5) */
    if (lr !== la) {
      /* hándicap: si la línea del local baja (−2.5 → −4.5) el mercado se fue al local; total/props: si sube, al Más */
      const d = tipo === 'sp' ? lr - la : la - lr;
      return Math.abs(d) >= ul ? { lado: d > 0 ? 0 : 1, mag: +Math.abs(d).toFixed(1), unidad: 'línea' } : null;
    }
    return porPrecio(up);
  }
  return null;
}

/* ---------- detector ----------
   Mira cada mercado de un juego que no ha empezado y devuelve las señales que cumplen el umbral:
     rapido     el mercado se movió en las últimas 2 horas
     acumulado  el mercado se movió desde la apertura de la casa
     kalshi     Kalshi y DraftKings no coinciden en el ganador (KALSHI_DIF puntos o más)
   Cada señal lleva un «nivel» (1, 2, 3 = una, dos o tres veces el umbral) para no repetir la misma. */
function detectar(j, ahora) {
  const out = [];
  if (j.st !== 'pre' || !(j.ts > ahora) || j.cancel) return out;
  const U = C.umbral(j.dep);
  Object.keys(j.m).forEach(clave => {
    const m = j.m[clave]; if (m.t === 'k') return;
    const act = ultima(m); if (!act || ahora - (m.visto || act.t) > 50 * 60e3) return;   /* mercado viejo o retirado */
    const refs = [];
    const abre = m.abre ? { c: m.abre.c, l: m.abre.l, t: null } : (m.serie.length ? foto(m.serie[0]) : null);
    if (abre) refs.push(['acumulado', abre]);
    const corte = ahora - C.HORAS_RAPIDO * HORA, v = valorEn(m.serie, corte);
    if (v) refs.push(['rapido', foto(v)]);
    else if (m.serie.length && m.serie[0][0] <= ahora - 45 * 60e3) refs.push(['rapido', foto(m.serie[0])]);
    refs.forEach(([cual, ref]) => {
      const mv = movimiento(m.t, ref, act, U, cual); if (!mv) return;
      const base = m.t === 'ml' ? U.ml[cual] : (mv.unidad === 'línea' ? (m.t === 'prop' ? U.prop.linea : U[m.t][cual]) : (m.t === 'prop' ? U.prop.precio : U.precio));
      const nivel = Math.min(3, Math.floor(mv.mag / base));
      out.push({ clave: [j.id, clave, cual, mv.lado, nivel].join('|'), tipo: cual, mk: clave, mt: m.t, lado: mv.lado, mag: mv.mag, unidad: mv.unidad, nivel,
        antes: ref, ahora: act });
    });
  });
  /* Kalshi contra DraftKings en el ganador (solo juegos de dos lados) */
  const k = j.m.k, ml = j.m.ml;
  if (k && ml) {
    const fk = ultima(k), fm = ultima(ml);
    if (fk && fm && fm.c.length === 2 && ahora - k.visto < 50 * 60e3 && ahora - ml.visto < 50 * 60e3) {
      const pk = probs('k', fk.c), pm = probs('ml', fm.c);
      if (pk && pm) {
        const d = (pk[0] - pm[0]) * 100;
        if (Math.abs(d) >= C.KALSHI_DIF) {
          const lado = d > 0 ? 0 : 1, nivel = Math.min(3, Math.floor(Math.abs(d) / C.KALSHI_DIF));
          out.push({ clave: [j.id, 'ml', 'kalshi', lado, nivel].join('|'), tipo: 'kalshi', mk: 'ml', mt: 'ml', lado, mag: +Math.abs(d).toFixed(1), unidad: 'pts', nivel,
            antes: { c: fk.c, l: null, t: fk.t, kalshi: true }, ahora: fm });
        }
      }
    }
  }
  return out;
}

/* señal detectada → registro que se guarda y se mide después */
function registroSenal(j, s, ahora, ligaNombre) {
  const m = j.m[s.mk], tipo = m.t, pa = probs(tipo, s.ahora.c);
  const l = lineaLado(tipo, s.ahora.l, s.lado);
  const desc = s.tipo === 'kalshi'
    ? 'Kalshi ' + Math.round(probs('k', s.antes.c)[s.lado] * 100) + '% · DraftKings ' + Math.round(pa[s.lado] * 100) + '%'
    : (s.unidad === 'línea'
      ? (tipo === 'sp' ? 'línea ' + fmtL(lineaLado('sp', s.antes.l, s.lado)) + ' → ' + fmtL(l) : 'línea ' + s.antes.l + ' → ' + s.ahora.l)
      : cuotaTxt(tipo, s.antes.c, s.lado) + ' → ' + cuotaTxt(tipo, s.ahora.c, s.lado) + (s.ahora.l !== null && s.ahora.l !== undefined ? ' (línea ' + fmtL(l) + ')' : ''));
  const r = {
    id: s.clave, t: ahora, dep: j.dep, liga: ligaNombre, jid: j.id, ts: j.ts, partido: j.a.ab + ' @ ' + j.h.ab,
    tipo: s.tipo, mk: s.mk, mt: tipo, lado: s.lado, mag: s.mag, unidad: s.unidad, nivel: s.nivel,
    txt: etiqueta(j, s.mk, s.lado, s.ahora.l), desc,
    c: s.ahora.c[s.lado], p: pa ? +pa[s.lado].toFixed(4) : null, l
  };
  if (s.ahora.c.length === 2) r.cOtro = s.ahora.c[1 - s.lado];
  if (tipo === 'prop') { r.ath = m.ath; r.k = m.k; }
  return r;
}
function fmtL(v) { return v === null || v === undefined ? '—' : (v > 0 ? '+' : '') + v; }

module.exports = { nuevoJuego, actualizarMeta, anotar, probs, valorEn, ultima, fijarCierre, lineaLado, etiqueta, cuotaTxt, movimiento, detectar, registroSenal, fmtL, amTxt };
