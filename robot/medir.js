'use strict';
/* ===================================================================
   TIGRE · MEDIDOR (puro, sin red)
   1) Resuelve cada señal cuando termina su juego: gana / pierde / push / nula (prop de un jugador que no jugó)
      y su CLV: si la línea de cierre terminó mejor o peor para quien entró en la señal.
   2) Arma las tablas: por tipo de señal, por mercado, por deporte y por tramo de cuota:
      cuántas acierta, cuánto prometía su cuota, rendimiento a la cuota de la señal y en contra.
   3) Calibración propia: con la línea de cierre de cada mercado de cada juego terminado,
      cuánto prometía el favorito y cuánto ganó (ganador, hándicap, total y props).
   =================================================================== */
const { ganancia, dec } = require('./lib.js');
const R = require('./registro.js');
const { TRAMOS_P, margen } = require('./historia.js');
const Z = require('./fuerza.js');

/* resultado de un lado de un mercado con el marcador final (y el boxscore para props) */
function resultado(mt, lado, l, j, box, m) {
  const hs = j.hs, as = j.as; if (hs === null || hs === undefined || as === null || as === undefined) return null;
  const cmp = (v, linea, mas) => (v === linea ? 'push' : ((mas ? v > linea : v < linea) ? 'gana' : 'pierde'));
  if (mt === 'ml' || mt === 'k') {
    const tres = m && m.serie && m.serie[0] && m.serie[0][1].length === 3;
    if (tres) { const g = hs > as ? 0 : (hs === as ? 1 : 2); return lado === g ? 'gana' : 'pierde'; }
    if (hs === as) return 'push';
    return (lado === 0) === (hs > as) ? 'gana' : 'pierde';
  }
  if (l === null || l === undefined) return null;
  if (mt === 'sp') { const mg = (lado === 0 ? hs - as : as - hs) + l; return mg === 0 ? 'push' : (mg > 0 ? 'gana' : 'pierde'); }
  if (mt === 'tot') return cmp(hs + as, l, lado === 0);
  if (mt === 'prop') {
    if (!box) return null;
    const st = box[String(m && m.ath)]; if (!st) return 'nula';       /* no jugó: las casas devuelven la apuesta */
    const v = st[m.k]; if (v === null || v === undefined) return null;
    return cmp(v, l, lado === 0);
  }
  return null;
}

/* CLV de una señal contra el cierre del mismo mercado.
   ganancia de línea: hándicap → línea de la señal − línea de cierre (para ese lado); total/props Más → cierre − señal; Menos → señal − cierre.
   Con la misma línea: puntos de probabilidad del cierre − de la señal. */
function clv(s, cierre) {
  if (!cierre || !cierre.c) return null;
  const pc = R.probs(s.mt, cierre.c); if (!pc) return null;
  const lc = R.lineaLado(s.mt, cierre.l, s.lado);
  const out = { cCierre: cierre.c[s.lado], pCierre: +pc[s.lado].toFixed(4), lCierre: lc };
  if (s.mt === 'ml' || lc === s.l || lc === null || s.l === null) {
    out.clvPts = +((pc[s.lado] - s.p) * 100).toFixed(1);
    out.clvSigno = Math.abs(out.clvPts) < 0.5 ? 0 : Math.sign(out.clvPts);
  } else {
    const g = s.mt === 'sp' ? s.l - lc : (s.lado === 0 ? lc - s.l : s.l - lc);
    out.clvLinea = +g.toFixed(1);
    out.clvSigno = Math.sign(g);
  }
  return out;
}

/* resuelve las señales pendientes de un juego terminado. Devuelve cuántas resolvió. */
function resolverSenales(senales, j, box) {
  let n = 0;
  senales.forEach(s => {
    if (s.jid !== j.id || s.res) return;
    const m = j.m[s.mk];
    const r = resultado(s.mt, s.lado, s.l, j, box, m); if (!r) return;
    s.res = r;
    s.g = r === 'nula' ? 0 : +ganancia(s.c, r).toFixed(4);
    if (s.cOtro !== undefined && r !== 'nula') s.gContra = +ganancia(s.cOtro, r === 'gana' ? 'pierde' : (r === 'pierde' ? 'gana' : 'push')).toFixed(4);
    const c = clv(s, j.cierre && j.cierre[s.mk]); if (c) Object.assign(s, c);
    s.marcador = j.a.ab + ' ' + j.as + ' - ' + j.hs + ' ' + j.h.ab;
    n++;
  });
  return n;
}

/* filas de calibración de un juego terminado: el favorito de cierre de cada mercado y si ganó.
   [dep, mercado, probabilidad del favorito, resultado 1 / 0 / 0.5 (push)] */
function filasCalibracion(j, box) {
  const out = [];
  Object.keys(j.cierre || {}).forEach(k => {
    const m = j.m[k], c = j.cierre[k]; if (!m || m.t === 'k') return;
    const p = R.probs(m.t, c.c); if (!p) return;
    let fav = 0; p.forEach((v, i) => { if (v > p[fav]) fav = i; });
    const r = resultado(m.t, fav, R.lineaLado(m.t, c.l, fav), j, box, m);
    if (!r || r === 'nula') return;
    out.push([j.dep, m.t, +p[fav].toFixed(3), r === 'gana' ? 1 : (r === 'push' ? 0.5 : 0)]);
  });
  return out;
}

/* filas de la ficha de fuerza de un juego terminado: el lado que tenía más fuerza al empezar, jugado a la cuota de cierre.
   [dep, mercado, puntaje, a favor, puntos con dato, probabilidad del cierre, cuota de cierre, resultado 1 / 0 / 0.5] */
function filasFuerza(j, box) {
  const out = [];
  Object.keys(j.fichaCierre || {}).forEach(mk => {
    const f = j.fichaCierre[mk], m = j.m[mk], ci = j.cierre && j.cierre[mk];
    if (!f || !m || !ci || !ci.c) return;
    const p = R.probs(m.t, ci.c); if (!p || p[f.lado] == null) return;
    const r = resultado(m.t, f.lado, R.lineaLado(m.t, ci.l, f.lado), j, box, m);
    if (!r || r === 'nula') return;
    out.push([j.dep, m.t, f.puntaje, f.favor, f.n, +p[f.lado].toFixed(3), ci.c[f.lado], r === 'gana' ? 1 : (r === 'push' ? 0.5 : 0)]);
  });
  return out;
}
const ORDEN_GRUPO = ['+3', '+2', '+1', '0', 'neg'];
function tablaFuerza(filas) {
  return ORDEN_GRUPO.map(gk => {
    const x = filas.filter(f => Z.grupo(f[2]) === gk); if (!x.length) return null;
    const sp = x.filter(f => f[7] !== 0.5), g = sp.filter(f => f[7] === 1).length;
    const roi = x.reduce((a, f) => a + ganancia(f[6], f[7] === 1 ? 'gana' : (f[7] === 0.5 ? 'push' : 'pierde')), 0) / x.length * 100;
    return { clave: gk, nombre: Z.NOM_GRUPO[gk], n: x.length,
      gana: sp.length ? +(g / sp.length * 100).toFixed(1) : null,
      promete: sp.length ? +(sp.reduce((a, f) => a + f[5], 0) / sp.length * 100).toFixed(1) : null,
      margen: sp.length ? margen(g / sp.length, sp.length) : null, roi: +roi.toFixed(1) };
  }).filter(Boolean);
}

/* ---------- tablas ---------- */
function agregar(lista) {
  const v = lista.filter(s => s.res && s.res !== 'nula');
  if (!v.length) return null;
  const dec2 = x => +x.toFixed(1);
  const sinPush = v.filter(s => s.res !== 'push'), g = sinPush.filter(s => s.res === 'gana').length;
  const conClv = v.filter(s => s.clvSigno !== undefined), ptsClv = v.filter(s => s.clvPts !== undefined);
  const contra = v.filter(s => s.gContra !== undefined);
  return {
    n: v.length,
    gana: sinPush.length ? dec2(g / sinPush.length * 100) : null,
    promete: sinPush.length ? dec2(sinPush.reduce((a, s) => a + (s.p || 0), 0) / sinPush.length * 100) : null,
    margen: sinPush.length ? margen(g / sinPush.length, sinPush.length) : null,
    roi: dec2(v.reduce((a, s) => a + (s.g || 0), 0) / v.length * 100),
    roiContra: contra.length ? dec2(contra.reduce((a, s) => a + s.gContra, 0) / contra.length * 100) : null,
    clvFavor: conClv.length ? dec2(conClv.filter(s => s.clvSigno > 0).length / conClv.length * 100) : null,
    clvContra: conClv.length ? dec2(conClv.filter(s => s.clvSigno < 0).length / conClv.length * 100) : null,
    clvPts: ptsClv.length ? dec2(ptsClv.reduce((a, s) => a + s.clvPts, 0) / ptsClv.length) : null
  };
}
const NOM_TIPO = { rapido: '⚡ Movimiento rápido (2 h)', acumulado: '📈 Movimiento desde la apertura', kalshi: '🔀 Kalshi contra la casa' };
const NOM_MT = { ml: 'Ganador', sp: 'Hándicap', tot: 'Total', prop: 'Props de jugador' };
/* una señal que sube de nivel (1× → 2× → 3×) es el mismo movimiento: para el récord cuenta solo la primera vez
   que saltó (juego + mercado + tipo + lado). La tabla «por fuerza» sí usa todas. */
function unicas(senales) {
  const vistas = new Set(), out = [];
  senales.slice().sort((a, b) => a.t - b.t).forEach(s => { const k = s.jid + '|' + s.mk + '|' + s.tipo + '|' + s.lado; if (vistas.has(k)) return; vistas.add(k); out.push(s); });
  return out;
}
function tablas(todas, calib, fuerza) {
  const senales = unicas(todas);
  const out = { generado: null, total: agregar(senales), porTipo: [], porMercado: [], porTipoMercado: [], porDeporte: [], porNivel: [], porTramo: [], calibracion: {} };
  const grupos = (clave, nombre, lista) => {
    const g = {}; (lista || senales).forEach(s => { const k = clave(s); if (k === null) return; (g[k] = g[k] || []).push(s); });
    return Object.keys(g).map(k => Object.assign({ clave: k, nombre: nombre(k) }, agregar(g[k]) || { n: 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  };
  out.porTipo = grupos(s => s.tipo, k => NOM_TIPO[k] || k);
  out.porMercado = grupos(s => s.mt, k => NOM_MT[k] || k);
  out.porTipoMercado = grupos(s => s.tipo + '|' + s.mt, k => (NOM_TIPO[k.split('|')[0]] || k) + ' · ' + (NOM_MT[k.split('|')[1]] || ''));
  out.porTipoMercado.forEach(g => { g.veredicto = veredicto(g); g.acierto = acierto(g); });
  /* ficha de fuerza: al cierre de cada juego (todos los juegos) y en las señales */
  const fz = fuerza || [];
  out.fuerzaCierre = { n: fz.length, todos: tablaFuerza(fz), completas: tablaFuerza(fz.filter(f => f[4] >= 3)), porMercado: {} };
  ['ml', 'sp', 'tot'].forEach(mt => { const x = fz.filter(f => f[1] === mt); if (x.length) out.fuerzaCierre.porMercado[mt] = { nombre: NOM_MT[mt], n: x.length, tramos: tablaFuerza(x) }; });
  out.fuerzaSenales = grupos(s => (s.fz ? Z.grupo(s.fz.p) : null), k => Z.NOM_GRUPO[k] || k)
    .sort((a, b) => ORDEN_GRUPO.indexOf(a.clave) - ORDEN_GRUPO.indexOf(b.clave));
  [out.fuerzaCierre.todos, out.fuerzaCierre.completas].concat(Object.values(out.fuerzaCierre.porMercado).map(x => x.tramos)).forEach(l => (l || []).forEach(g => { g.acierto = acierto(g); }));
  /* progreso hacia las 300 resueltas por tipo de señal × mercado (pendientes = las que esperan que termine su juego) */
  const prog = {};
  senales.forEach(s => {
    const k = s.tipo + '|' + s.mt, x = prog[k] = prog[k] || { clave: k, nombre: (NOM_TIPO[s.tipo] || s.tipo) + ' · ' + (NOM_MT[s.mt] || s.mt), resueltas: 0, pendientes: 0 };
    if (!s.res) x.pendientes++; else if (s.res !== 'nula') x.resueltas++;
  });
  out.progreso = Object.values(prog).sort((a, b) => (b.resueltas + b.pendientes) - (a.resueltas + a.pendientes));
  out.porDeporte = grupos(s => s.dep, k => k.toUpperCase());
  out.porNivel = grupos(s => String(s.nivel), k => ['', 'Movimiento normal (1×)', 'Movimiento fuerte (2×)', 'Movimiento muy fuerte (3× o más)'][+k] || k, todas);
  out.porTramo = grupos(s => { if (!(s.p > 0)) return null; const t = TRAMOS_TODOS.find(x => s.p >= x[0] && s.p < x[1]); return t ? t[2] : null; }, k => k)
    .sort((a, b) => TRAMOS_TODOS.findIndex(t => t[2] === a.clave) - TRAMOS_TODOS.findIndex(t => t[2] === b.clave));
  /* calibración propia por mercado */
  const porMt = {}; (calib || []).forEach(f => { (porMt[f[1]] = porMt[f[1]] || []).push(f); });
  Object.keys(porMt).forEach(mt => {
    out.calibracion[mt] = { nombre: NOM_MT[mt] || mt, n: porMt[mt].length, tramos: TRAMOS_P.map(t => {
      const x = porMt[mt].filter(f => f[2] >= t[0] && f[2] < t[1]), sp = x.filter(f => f[3] !== 0.5), g = sp.filter(f => f[3] === 1).length;
      return { tramo: Math.round(t[0] * 100) + (t[1] > 1 ? '%+' : '–' + Math.round(t[1] * 100) + '%'), n: x.length,
        promete: sp.length ? +(sp.reduce((a, f) => a + f[2], 0) / sp.length * 100).toFixed(1) : null,
        gana: sp.length ? +(g / sp.length * 100).toFixed(1) : null, margen: sp.length ? margen(g / sp.length, sp.length) : null };
    }) };
  });
  /* 🎯 lo que más acierta: todos los grupos con 30+ resueltas, de mayor a menor % de aciertos */
  const cand = [];
  const meter = (lista, de) => (lista || []).forEach(g => { if (g.n >= 30 && g.gana != null) cand.push({ nombre: g.nombre, de, n: g.n, gana: g.gana, promete: g.promete, roi: g.roi, margen: g.margen, acierto: acierto(g) }); });
  meter(out.porTipoMercado, 'Señal'); meter(out.porDeporte, 'Deporte'); meter(out.porTramo, 'Tramo de cuota'); meter(out.fuerzaSenales, 'Señal por fuerza');
  meter(out.fuerzaCierre.todos, 'Ficha al cierre'); Object.values(out.fuerzaCierre.porMercado).forEach(x => meter(x.tramos, 'Ficha · ' + x.nombre));
  out.masAciertan = cand.sort((a, b) => b.gana - a.gana || b.n - a.n).slice(0, 12);
  return out;
}
const TRAMOS_TODOS = [[0, 0.35, 'menos de 35%'], [0.35, 0.45, '35–45%'], [0.45, 0.55, '45–55%'], [0.55, 0.65, '55–65%'], [0.65, 0.75, '65–75%'], [0.75, 1.01, '75%+']];

/* veredicto de un grupo de señales (para el sello en la página y en los avisos)
   probada  300+ resueltas, gana por encima de lo que prometía más allá del margen, ROI positivo y el cierre a favor la mayoría de las veces
   pierde   100+ resueltas y ROI de −3% o peor
   prueba   todo lo demás (todavía no se sabe) */
function veredicto(g) {
  if (!g || !g.n) return 'prueba';
  if (g.n >= 300 && g.gana !== null && g.promete !== null && g.gana - g.promete >= (g.margen || 0) && g.roi > 0 && (g.clvFavor === null || g.clvFavor >= 50)) return 'probada';
  if (g.n >= 100 && g.roi <= -3) return 'pierde';
  return 'prueba';
}
/* ---------- picks anticipados ---------- */
/* resuelve los anticipados de un juego terminado: al precio temprano, el mismo pick al cierre y el CLV */
function resolverAnticipados(lista, j, box) {
  let n = 0;
  lista.forEach(a => {
    if (a.jid !== j.id || a.res) return;
    const m = j.m[a.mk]; if (!m) return;
    const r = resultado(a.mt, a.lado, a.l, j, box, m); if (!r) return;
    a.res = r; a.g = r === 'nula' ? 0 : +ganancia(a.c, r).toFixed(4);
    const ci = j.cierre && j.cierre[a.mk];
    if (ci && ci.c && r !== 'nula') {
      const c = clv(a, ci); if (c) Object.assign(a, c);
      const rc = resultado(a.mt, a.lado, R.lineaLado(a.mt, ci.l, a.lado), j, box, m);
      if (rc && rc !== 'nula') a.gCierre = +ganancia(ci.c[a.lado], rc).toFixed(4);
    }
    a.marcador = j.dep === 'tenis' ? (j.det || '') : j.a.ab + ' ' + j.as + ' - ' + j.hs + ' ' + j.h.ab;
    n++;
  });
  return n;
}
const NOM_ANT = { 'ficha|ml': '📅 Ganador · lado con más fuerza', 'ficha|sp': '📅 Hándicap · lado con más fuerza', 'ficha|tot': '📅 Total · lado con más fuerza', 'propFav|prop': '📅 Props · favorito al salir' };
function tablaAnticipados(lista) {
  const mas = g => {
    const x = g.filter(a => a.gCierre !== undefined), base = agregar(g) || { n: 0 };
    base.roiCierre = x.length ? +(x.reduce((s2, a) => s2 + a.gCierre, 0) / x.length * 100).toFixed(1) : null;
    base.horas = g.length ? +(g.reduce((s2, a) => s2 + (a.horas || 0), 0) / g.length).toFixed(1) : null;
    base.acierto = acierto(base);
    return base;
  };
  const grupos2 = (clave, nombre, l) => {
    const g = {}; l.forEach(a => { const k = clave(a); if (k == null) return; (g[k] = g[k] || []).push(a); });
    return Object.keys(g).map(k => Object.assign({ clave: k, nombre: nombre(k) }, mas(g[k]))).filter(x => x.n > 0);
  };
  const res = lista.filter(a => a.res && a.res !== 'nula');
  return {
    total: lista.length, resueltos: res.length, pendientes: lista.filter(a => !a.res).length,
    porTipo: grupos2(a => a.tipo + '|' + a.mt, k => NOM_ANT[k] || k, res),
    porFuerza: grupos2(a => (a.tipo === 'ficha' && a.fz ? Z.grupo(a.fz.p) : null), k => Z.NOM_GRUPO[k] || k, res)
      .sort((a, b) => ['+3', '+2', '+1', '0', 'neg'].indexOf(a.clave) - ['+3', '+2', '+1', '0', 'neg'].indexOf(b.clave))
  };
}

/* sello de aciertos (aparte de la rentabilidad): lo que más acierta, aunque pague poco
   alto  100+ resueltas y acierta 60% o más · va  30+ resueltas y acierta 60% o más (todavía puede cambiar) */
function acierto(g) {
  if (!g || g.gana == null) return null;
  if (g.n >= 100 && g.gana >= 60) return 'alto';
  if (g.n >= 30 && g.gana >= 60) return 'va';
  return null;
}
module.exports = { resolverAnticipados, tablaAnticipados, acierto, filasFuerza, tablaFuerza, unicas, veredicto, resultado, clv, resolverSenales, filasCalibracion, agregar, tablas, NOM_TIPO, NOM_MT, dec };
