'use strict';
/* ===================================================================
   TIGRE · FICHA DE FUERZA (pura, sin red)

   Para cada lado de un mercado (ganador, hándicap, total) se revisan 4 puntos, cada uno con un dato:
     📈 mercado   hacia dónde se movió la línea desde la apertura (TIGRE)
     🧠 modelo    lo que le da el Modelo OVA contra la casa (registro de la liga de ODDX, solo lectura)
     🔀 otros     Kalshi o Polymarket contra la casa
     📋 contexto  forma reciente (fútbol) o récord en casa / fuera (NBA, NHL, NFL, NCAA)
   Cada punto queda: 'favor' · 'contra' · 'neutro' (hay dato pero no inclina) · 'sin' (no hay dato).
   puntaje = a favor − en contra. La ficha del mercado es la del lado con más puntaje.
   Esto se MIDE: TIGRE guarda la ficha al cierre de cada juego y dice si los puntajes altos ganan más
   de lo que prometía su cuota. Hasta que eso pase, la ficha es una explicación, no una garantía.
   =================================================================== */
const R = require('./registro.js');

const U = {
  ml: 2,            /* 📈 ganador: puntos de probabilidad que se movió desde la apertura */
  linea: 0.5,       /* 📈 hándicap / total: puntos de línea */
  precio: 3,        /* 📈 hándicap / total con la misma línea: puntos de probabilidad */
  modelo: 3,        /* 🧠 diferencia del modelo contra la casa, en puntos */
  otros: 2,         /* 🔀 diferencia de Kalshi o Polymarket contra la casa, en puntos */
  forma: 3,         /* 📋 fútbol: diferencia de puntos en los últimos 5 (G=3, E=1) */
  record: 10        /* 📋 NBA/NHL/NFL/NCAA: diferencia de % de victorias (en casa contra fuera) */
};
const FUTBOL = ['eng', 'esp', 'ita', 'ger', 'fra', 'ucl', 'uel', 'mls', 'mex'];
const depRegistro = dep => (FUTBOL.includes(dep) ? 'futbol' : dep);

/* ---------- registro de la liga de ODDX ---------- */
const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const apellido = s => { const p = sinAcentos(s).split(/\s+/); return p[p.length - 1] || ''; };
/* índice: 'dep|idESPN' → item, y tenis por apellidos */
function indexarRegistro(reg) {
  const out = { id: {}, tenis: [] };
  Object.values((reg && reg.items) || {}).forEach(it => {
    if (!it || !it.p) return;
    out.id[it.dep + '|' + it.ext] = it;
    if (it.dep === 'tenis') out.tenis.push(it);
  });
  return out;
}
/* el item del registro de un juego de TIGRE y si viene al revés (tenis) */
function itemDe(idx, j) {
  if (!idx) return null;
  if (j.dep === 'tenis') {
    const h = apellido(j.h.n), a = apellido(j.a.n);
    for (const it of idx.tenis) {
      const l = apellido(it.local), v = apellido(it.visita);
      if (l === h && v === a) return { it, reves: false };
      if (l === a && v === h) return { it, reves: true };
    }
    return null;
  }
  const it = idx.id[depRegistro(j.dep) + '|' + j.id];
  return it ? { it, reves: false } : null;
}
/* probabilidades de una fuente del registro en el orden de TIGRE: [local, visita] o [local, empate, visita] */
function probsRegistro(x, fuente, tres) {
  if (!x) return null;
  const p = x.it.p[fuente]; if (!p || p.length < 2) return null;
  let l = p[0], v = p[1], e = p[2] || 0;
  if (x.reves) { const t = l; l = v; v = t; }
  const o = tres ? [l, e, v] : [l, v], s = o.reduce((a, b) => a + b, 0);
  return s > 0 ? o.map(q => q / s) : null;
}
function fuenteModelo(x) { if (!x) return null; if (x.it.p.ova) return { k: 'ova', n: 'OVA' }; if (x.it.p.modelo) return { k: 'modelo', n: 'Modelo OVA' }; return null; }

/* ---------- contexto: forma y récord ---------- */
function puntosForma(f) { if (!f || !/^[WDL]+$/.test(f)) return null; return [...f.slice(-5)].reduce((a, c) => a + (c === 'W' ? 3 : (c === 'D' ? 1 : 0)), 0); }
function pctRecord(sum) {
  if (!sum) return null;
  const n = String(sum).split('-').map(x => parseInt(x, 10)); if (n.some(x => !isFinite(x))) return null;
  const tot = n.reduce((a, b) => a + b, 0); if (tot < 3) return null;
  return { pct: n[0] / tot, txt: sum };
}
const lado = (j, i) => (i === 0 ? j.h : j.a);

/* ---------- los 4 puntos de un lado ---------- */
function evaluar(j, mk, i, idx) {
  const m = j.m[mk]; if (!m) return null;
  const u = R.ultima(m); if (!u) return null;
  const pa = R.probs(m.t, u.c); if (!pa) return null;
  const tres = m.t === 'ml' && u.c.length === 3;
  const nombre = i2 => (m.t === 'tot' ? (i2 === 0 ? 'el Más' : 'el Menos') : (tres && i2 === 1 ? 'el empate' : lado(j, i2 === 2 ? 1 : i2).n));
  const quien = nombre(i), pts = [];
  const pc = v => Math.round(v * 100) + '%';
  const add = (k, estado, txt) => pts.push([k, estado, txt]);
  const signo = (d, umbral) => (d >= umbral ? 'favor' : (d <= -umbral ? 'contra' : 'neutro'));
  const fmt = v => (m.t === 'sp' ? R.fmtL(v) : String(v));

  /* 📈 mercado */
  const abre = m.abre || (m.serie.length ? { c: m.serie[0][1], l: m.serie[0][2] } : null);
  if (!abre || m.serie.length < 1) add('mercado', 'sin', 'Sin apertura para comparar');
  else if (m.t === 'ml') {
    const po = R.probs('ml', abre.c);
    if (!po || po.length !== pa.length) add('mercado', 'sin', 'Sin apertura para comparar');
    else { const d = (pa[i] - po[i]) * 100; add('mercado', signo(d, U.ml), (Math.abs(d) < U.ml ? 'La línea casi no se mueve: ' + quien + ' ' + pc(po[i]) + ' → ' + pc(pa[i]) : (d > 0 ? 'Le entró dinero a ' : 'Se fue el dinero de ') + quien + ': ' + pc(po[i]) + ' → ' + pc(pa[i]) + ' (' + (d > 0 ? '+' : '') + d.toFixed(1) + ' pts)')); }
  } else {
    const lo = R.lineaLado(m.t, abre.l, i), la = R.lineaLado(m.t, u.l, i);
    if (lo == null || la == null) add('mercado', 'sin', 'Sin línea de apertura');
    else if (lo !== la) {
      const mejora = m.t === 'sp' ? lo - la : (i === 0 ? la - lo : lo - la);    /* + = el mercado se fue hacia este lado */
      const e = Math.abs(mejora) >= U.linea ? (mejora > 0 ? 'favor' : 'contra') : 'neutro';
      add('mercado', e, (mejora > 0 ? 'El mercado se fue hacia ' : 'El mercado se fue en contra de ') + quien + ': línea ' + fmt(lo) + ' → ' + fmt(la));
    } else {
      const po = R.probs(m.t, abre.c);
      if (!po) add('mercado', 'neutro', 'Misma línea que en la apertura (' + fmt(la) + ')');
      else { const d = (pa[i] - po[i]) * 100; add('mercado', signo(d, U.precio), 'Misma línea (' + fmt(la) + '); el precio de ' + quien + ' pasó de ' + pc(po[i]) + ' a ' + pc(pa[i])); }
    }
  }

  /* 🧠 modelo OVA (registro de la liga) */
  const x = itemDe(idx, j), fm = fuenteModelo(x);
  if (m.t === 'ml') {
    const pm = fm ? probsRegistro(x, fm.k, tres) : null;
    if (!pm || pm.length !== pa.length) add('modelo', 'sin', 'El Modelo OVA no tiene este juego');
    else { const d = (pm[i] - pa[i]) * 100; add('modelo', signo(d, U.modelo), fm.n + ' le da ' + pc(pm[i]) + ' a ' + quien + '; la casa, ' + pc(pa[i]) + ' (' + (d > 0 ? '+' : '') + d.toFixed(1) + ' pts)'); }
  } else {
    const e = x && x.it.mk && x.it.mk[m.t === 'sp' ? 'han' : 'tot'];
    const lineaReg = e && e.l, pmod = e && e.p && e.p.modelo;
    const lineaTigre = u.l, mismaLinea = lineaReg != null && lineaTigre != null && Math.abs(lineaReg - lineaTigre) < 1e-9 && !x.reves;
    if (!e || pmod == null) add('modelo', 'sin', 'El Modelo OVA no calcula este mercado aquí');
    else if (!mismaLinea) add('modelo', 'sin', 'El Modelo OVA tiene otra línea (' + fmt(lineaReg) + ')');
    else { const pmL = i === 0 ? pmod : 1 - pmod, d = (pmL - pa[i]) * 100; add('modelo', signo(d, U.modelo), 'Modelo OVA: ' + quien + ' ' + pc(pmL) + '; la casa, ' + pc(pa[i]) + ' (' + (d > 0 ? '+' : '') + d.toFixed(1) + ' pts)'); }
  }

  /* 🔀 otros mercados: Kalshi (si TIGRE lo tiene) o Polymarket (registro) — solo ganador */
  if (m.t !== 'ml') add('otros', 'sin', 'Kalshi y Polymarket solo tienen el ganador');
  else {
    let po = null, fuente = '';
    if (j.m.k && !tres) { const fk = R.ultima(j.m.k); if (fk) { po = R.probs('k', fk.c); fuente = 'Kalshi'; } }
    if (!po) { const pp = probsRegistro(x, 'polymarket', tres); if (pp && pp.length === pa.length) { po = pp; fuente = 'Polymarket'; } }
    if (!po) add('otros', 'sin', 'Ni Kalshi ni Polymarket tienen este juego');
    else { const d = (po[i] - pa[i]) * 100; add('otros', signo(d, U.otros), fuente + ' le da ' + pc(po[i]) + ' a ' + quien + '; la casa, ' + pc(pa[i]) + (Math.abs(d) < U.otros ? ' (coinciden)' : ' (' + (d > 0 ? '+' : '') + d.toFixed(1) + ' pts)')); }
  }

  /* 📋 contexto: forma (fútbol) o récord en casa / fuera */
  if (m.t === 'tot' || (tres && i === 1) || j.dep === 'tenis') add('contexto', 'sin', m.t === 'tot' ? 'El contexto de equipo no aplica al total' : (j.dep === 'tenis' ? 'Sin datos de forma en tenis' : 'El empate no tiene forma propia'));
  else {
    const ladoReal = tres ? (i === 0 ? 0 : 1) : i;                 /* 0 = local, 1 = visita */
    const A = ladoReal === 0 ? j.h : j.a, B = ladoReal === 0 ? j.a : j.h;
    if (FUTBOL.includes(j.dep)) {
      const fa = puntosForma(A.form), fb = puntosForma(B.form);
      if (fa == null || fb == null) add('contexto', 'sin', 'Sin forma reciente en ESPN');
      else { const d = fa - fb; add('contexto', signo(d, U.forma), 'Últimos 5: ' + A.n + ' ' + A.form.slice(-5) + ' (' + fa + ' pts) · ' + B.n + ' ' + B.form.slice(-5) + ' (' + fb + ' pts)'); }
    } else {
      const sitA = ladoReal === 0 ? 'home' : 'road', sitB = ladoReal === 0 ? 'road' : 'home';
      const ra = A.rec && (pctRecord(A.rec[sitA]) || pctRecord(A.rec.total)), rb = B.rec && (pctRecord(B.rec[sitB]) || pctRecord(B.rec.total));
      const etq = (T, s2) => (T.rec && pctRecord(T.rec[s2]) ? (s2 === 'home' ? 'en casa ' : 'fuera ') : 'en total ');
      if (!ra || !rb) add('contexto', 'sin', 'Sin récords suficientes en ESPN');
      else { const d = (ra.pct - rb.pct) * 100; add('contexto', signo(d, U.record), A.n + ' ' + etq(A, sitA) + ra.txt + ' (' + Math.round(ra.pct * 100) + '%) · ' + B.n + ' ' + etq(B, sitB) + rb.txt + ' (' + Math.round(rb.pct * 100) + '%)'); }
    }
  }

  const favor = pts.filter(p => p[1] === 'favor').length, contra = pts.filter(p => p[1] === 'contra').length;
  const conDato = pts.filter(p => p[1] !== 'sin').length;
  return { mk, mt: m.t, lado: i, quien, favor, contra, n: conDato, puntaje: favor - contra, pts, c: u.c[i], l: R.lineaLado(m.t, u.l, i) };
}

/* la ficha de un mercado: el lado con más puntaje (desempate: más a favor, después el que más se movió) */
function fichaMercado(j, mk, idx) {
  const m = j.m[mk]; if (!m) return null;
  const u = R.ultima(m); if (!u) return null;
  let mejor = null;
  u.c.forEach((_, i) => {
    const e = evaluar(j, mk, i, idx); if (!e) return;
    const mov = (e.pts.find(p => p[0] === 'mercado') || [])[1] === 'favor' ? 1 : 0;
    if (!mejor || e.puntaje > mejor.puntaje || (e.puntaje === mejor.puntaje && (e.favor > mejor.favor || (e.favor === mejor.favor && mov > mejor._mov)))) { mejor = e; mejor._mov = mov; }
  });
  if (mejor) delete mejor._mov;
  return mejor;
}
function fichaJuego(j, idx) {
  const out = {};
  ['ml', 'sp', 'tot'].forEach(mk => { const f = fichaMercado(j, mk, idx); if (f) out[mk] = f; });
  return Object.keys(out).length ? out : null;
}
/* versión corta para guardar en una señal */
function resumen(e) { return e ? { p: e.puntaje, f: e.favor, c: e.contra, n: e.n, pts: e.pts } : null; }
/* grupo de puntaje para medir */
function grupo(puntaje) { return puntaje >= 3 ? '+3' : (puntaje <= -1 ? 'neg' : String('+' + puntaje).replace('+0', '0')); }
const NOM_GRUPO = { '+3': '💪💪💪 +3 o más', '+2': '💪💪 +2', '+1': '💪 +1', '0': '➖ 0 (pareja)', neg: '👎 negativa' };

module.exports = { U, evaluar, fichaMercado, fichaJuego, resumen, grupo, NOM_GRUPO, indexarRegistro, itemDe, probsRegistro, puntosForma, pctRecord, depRegistro };
