'use strict';
/* ===================================================================
   TIGRE · FUENTES: ESPN (cuotas de DraftKings con apertura y actual, props, marcador y boxscore) y Kalshi.
   Las funciones parsear* son puras (se prueban con robot/pruebas.js); bajar* hacen las llamadas.
   =================================================================== */
const { am, num, pedir, pool, ymd, diaET } = require('./lib.js');
const { LIGAS, PROPS, TENIS, KALSHI_COMISION, KALSHI_SPREAD_MAX } = require('./config.js');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/';
const CORE = 'https://sports.core.api.espn.com/v2/sports/';
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';

/* ---------- marcador (scoreboard) ---------- */
function parsearScoreboard(j, dep) {
  const out = [];
  ((j && j.events) || []).forEach(e => {
    const c = e.competitions && e.competitions[0]; if (!c || !c.competitors) return;
    let h = null, a = null; c.competitors.forEach(x => { if (x.homeAway === 'home') h = x; else if (x.homeAway === 'away') a = x; });
    if (!h || !a || !h.team || !a.team) return;
    const st = (e.status && e.status.type) || {};
    out.push({
      id: String(e.id), dep, ts: Date.parse(e.date),
      st: st.state || 'pre', fin: st.completed === true, det: st.shortDetail || st.detail || '',
      h: { ab: h.team.abbreviation || '', n: h.team.shortDisplayName || h.team.displayName || '' },
      a: { ab: a.team.abbreviation || '', n: a.team.shortDisplayName || a.team.displayName || '' },
      hs: num(h.score), as: num(a.score),
      cancel: /postpon|cancel|suspend/i.test(String(st.name || '') + ' ' + String(st.description || ''))
    });
  });
  return out;
}
/* ts = día (hora del Este); sin ts = la semana en curso (NFL y NCAA Football) */
async function bajarScoreboard(dep, ts, hasta) {
  const L = LIGAS[dep];
  const q = (ts ? 'dates=' + ymd(ts) + (hasta ? '-' + ymd(hasta) : '') + '&' : '') + (L.grupos ? 'groups=' + L.grupos + '&' : '') + 'limit=400';
  return parsearScoreboard(await pedir(SITE + L.ruta + '/scoreboard?' + q), dep);
}

/* ---------- cuotas del juego (endpoint core: trae apertura y actual) ---------- */
/* devuelve { prov, ml:{abre:[..], ahora:[..]}, sp:{abre:{c:[h,a], l:lineaLocal}, ahora:{...}}, tot:{abre:{c:[o,u], l}, ahora:{...}} }
   ml es [local, visita] o, en fútbol, [local, empate, visita] */
function parsearOdds(j, futbol) {
  const items = (j && j.items) || [];
  const it = items.find(i => i.provider && String(i.provider.id) === '100') || items.find(i => i.provider && !/live/i.test(i.provider.name || '')) || null;
  if (!it) return null;
  const H = it.homeTeamOdds || {}, A = it.awayTeamOdds || {}, X = it.drawOdds || {};
  const ruta = (o, r) => r.split('.').reduce((v, k) => (v == null ? v : v[k]), o);
  const out = { prov: (it.provider && it.provider.name) || '?' };
  /* ganador */
  const mlAhora = [am(ruta(H, 'current.moneyLine') || H.moneyLine), am(ruta(A, 'current.moneyLine') || A.moneyLine)];
  const mlAbre = [am(ruta(H, 'open.moneyLine')), am(ruta(A, 'open.moneyLine'))];
  if (futbol) {
    const x = am(ruta(X, 'current.moneyLine') || X.moneyLine), xo = am(ruta(X, 'open.moneyLine'));
    mlAhora.splice(1, 0, x); mlAbre.splice(1, 0, xo);
  }
  if (mlAhora.every(v => v !== null)) out.ml = { ahora: mlAhora, abre: mlAbre.every(v => v !== null) ? mlAbre : null };
  /* hándicap (línea del local) */
  const sp = (lado, cuando) => ({ l: num(ruta(lado, cuando + '.pointSpread')), c: am(ruta(lado, cuando + '.spread')) });
  const spA = { h: sp(H, 'current'), a: sp(A, 'current') }, spO = { h: sp(H, 'open'), a: sp(A, 'open') };
  if (spA.h.l === null && isFinite(+it.spread) && it.spread !== null) spA.h.l = +it.spread;
  if (spA.h.c === null) spA.h.c = am(H.spreadOdds);
  if (spA.a.c === null) spA.a.c = am(A.spreadOdds);
  if (spA.h.l !== null && spA.h.c !== null && spA.a.c !== null && Math.abs(spA.h.l) < 45) {
    out.sp = { ahora: { c: [spA.h.c, spA.a.c], l: spA.h.l }, abre: (spO.h.l !== null && spO.h.c !== null && spO.a.c !== null) ? { c: [spO.h.c, spO.a.c], l: spO.h.l } : null };
  }
  /* total */
  const totL = num(ruta(it, 'current.total')) !== null ? num(ruta(it, 'current.total')) : (isFinite(+it.overUnder) && +it.overUnder > 0 ? +it.overUnder : null);
  const totC = [am(ruta(it, 'current.over')) || am(it.overOdds), am(ruta(it, 'current.under')) || am(it.underOdds)];
  const totO = { l: num(ruta(it, 'open.total')), c: [am(ruta(it, 'open.over')), am(ruta(it, 'open.under'))] };
  if (totL !== null && totL > 0 && totC.every(v => v !== null)) out.tot = { ahora: { c: totC, l: totL }, abre: (totO.l !== null && totO.c.every(v => v !== null)) ? totO : null };
  /* cierre oficial (ESPN lo llena cuando el juego ya empezó; antes no existe) */
  const ci = {};
  const mlC = [am(ruta(H, 'close.moneyLine')), am(ruta(A, 'close.moneyLine'))];
  if (futbol) mlC.splice(1, 0, am(ruta(X, 'close.moneyLine')) || (out.ml ? out.ml.ahora[1] : null));
  if (mlC.every(v => v !== null)) ci.ml = { c: mlC, l: null };
  const spC = { h: sp(H, 'close'), a: sp(A, 'close') };
  if (spC.h.l !== null && spC.h.c !== null && spC.a.c !== null) ci.sp = { c: [spC.h.c, spC.a.c], l: spC.h.l };
  const totCl = num(ruta(it, 'close.total')), totCc = [am(ruta(it, 'close.over')), am(ruta(it, 'close.under'))];
  if (totCl !== null && totCc.every(v => v !== null)) ci.tot = { c: totCc, l: totCl };
  if (Object.keys(ci).length) out.cierre = ci;
  return (out.ml || out.sp || out.tot) ? out : null;
}
async function bajarOdds(dep, id) {
  const L = LIGAS[dep];
  return parsearOdds(await pedir(CORE + L.core + '/events/' + id + '/competitions/' + id + '/odds'), !!L.futbol);
}

/* ---------- props de jugador (DraftKings en ESPN) ----------
   DraftKings manda el Más y el Menos sin etiqueta. Igual que OVA: el Más es el que cuesta parecido al hito «X+»
   (X = línea redondeada hacia arriba) del mismo jugador; si no hay hito, el primero es el Más.
   Devuelve { 'ath|k': { ath, k, n, ahora:{c:[más, menos], l}, abre:{c, l}|null } } con la línea principal (la más pareja). */
function parsearProps(items, dep, nombres) {
  const tipos = PROPS[dep] || []; if (!tipos.length) return {};
  const idAt = it => { const m = /athletes\/(\d+)/.exec((it && it.athlete && it.athlete.$ref) || ''); return m ? m[1] : null; };
  const lin = (it, cu) => { const v = cu === 'open' ? (it.open && it.open.target && it.open.target.value) : (it.current && it.current.target && it.current.target.value); return isFinite(+v) && v !== null && v !== undefined ? +v : null; };
  const cuo = (it, cu) => { const o = it.odds && it.odds.american; if (!o) return null; return am(cu === 'open' ? o.open : o.value); };
  const imp = a => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
  const g = {};
  (items || []).forEach(it => { const a = idAt(it), t = it && it.type && it.type.name; if (!a || !t) return; (g[a + '|' + t] = g[a + '|' + t] || []).push(it); });
  const out = {};
  tipos.forEach(T => {
    Object.keys(g).forEach(key => {
      const [a, t] = key.split('|'); if (t !== T.t) return;
      const porL = {};
      g[key].forEach(it => { const L = lin(it); if (L === null || cuo(it) === null) return; (porL[L] = porL[L] || []).push(it); });
      let mejor = null;
      Object.keys(porL).forEach(Ls => {
        const par = porL[Ls]; if (par.length !== 2) return;
        const L = +Ls; let o = par[0], u = par[1];
        const hito = (g[a + '|' + T.m] || []).find(it => lin(it) === Math.ceil(L) && cuo(it) !== null);
        if (hito) { const cm = imp(cuo(hito)); if (Math.abs(cm - imp(cuo(par[1]))) < Math.abs(cm - imp(cuo(par[0])))) { o = par[1]; u = par[0]; } }
        const r = { ath: a, k: T.k, ahora: { c: [cuo(o), cuo(u)], l: L } };
        const lo = lin(o, 'open'), co = [cuo(o, 'open'), cuo(u, 'open')];
        if (lo !== null && co.every(v => v !== null)) r.abre = { c: co, l: lo };
        const pO = imp(r.ahora.c[0]) / (imp(r.ahora.c[0]) + imp(r.ahora.c[1]));
        r._d = Math.abs(pO - 0.5);
        if (!mejor || r._d < mejor._d) mejor = r;
      });
      if (mejor) { delete mejor._d; mejor.n = (nombres && nombres[a]) || ''; out[a + '|' + T.k] = mejor; }
    });
  });
  return out;
}
async function bajarProps(dep, id) {
  const L = LIGAS[dep];
  const base = CORE + L.core + '/events/' + id + '/competitions/' + id + '/odds/100/propBets?limit=1000&page=';
  const p1 = await pedir(base + 1); if (!p1) return {};
  let items = p1.items || [];
  const pc = Math.min(4, p1.pageCount || 1);
  for (let pg = 2; pg <= pc; pg++) { try { const x = await pedir(base + pg); items = items.concat((x && x.items) || []); } catch (e) { } }
  return parsearProps(items, dep, null);
}
/* nombres de los jugadores con props (para mostrarlos): se piden una sola vez por atleta */
async function bajarNombres(dep, ids) {
  const L = LIGAS[dep], out = {};
  await pool(ids.map(id => async () => {
    try { const j = await pedir(CORE + L.core + '/athletes/' + id); if (j) out[id] = j.shortName || j.displayName || ''; } catch (e) { }
  }), 6);
  return out;
}

/* ---------- boxscore (para resolver props) ---------- */
function parsearBox(sum, dep) {
  const crudo = {};
  (((sum && sum.boxscore) || {}).players || []).forEach(t => (t.statistics || []).forEach(gr => {
    const k = gr.keys || gr.names || [];
    (gr.athletes || []).forEach(a => {
      const s = a.stats || [], id = String(a.athlete && a.athlete.id); if (!s.length || a.didNotPlay) return;
      const b = crudo[id] = crudo[id] || {};
      s.forEach((v, i) => { if (k[i] && !(k[i] in b)) b[k[i]] = num(v); });
    });
  }));
  const out = {};
  Object.keys(crudo).forEach(id => {
    const b = crudo[id], x = {};
    (PROPS[dep] || []).forEach(T => { let v; try { v = T.box(b); } catch (e) { v = null; } x[T.k] = (v === null || v === undefined || !isFinite(v)) ? null : v; });
    out[id] = x;
  });
  return out;
}
async function bajarBox(dep, id) {
  const L = LIGAS[dep];
  return parsearBox(await pedir(SITE + L.ruta + '/summary?event=' + id), dep);
}

/* ---------- Kalshi (ganador del juego, NBA/NHL/NFL/MLB) ---------- */
const MES = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const SIGLAS = { WAS: 'WSH', JAC: 'JAX', NOP: 'NO', SAS: 'SA', GSW: 'GS', NYK: 'NY', UTAH: 'UTA', LAK: 'LA', SJS: 'SJ', TBL: 'TB', NJD: 'NJ' };
function sigla(s) { s = String(s || '').toUpperCase(); return SIGLAS[s] || s; }
function dolares(m, k) { const d = parseFloat(m[k + '_dollars']); if (isFinite(d)) return Math.round(d * 100); const c = parseFloat(m[k]); return isFinite(c) ? Math.round(c) : null; }
function parsearKalshi(eventos) {
  const out = [];
  (eventos || []).forEach(ev => {
    const x = /-(\d{2})([A-Z]{3})(\d{2})/.exec(String(ev.event_ticker || '')); if (!x || !MES[x[2]]) return;
    const d = '20' + x[1] + '-' + MES[x[2]] + '-' + x[3];
    const ms = (ev.markets || []).filter(m => m && (m.status === 'active' || m.status === 'open'));
    if (ms.length !== 2) return;
    const e = ms.map(m => {
      const s = String(m.ticker || '').split('-').pop(), bid = dolares(m, 'yes_bid'), ask = dolares(m, 'yes_ask');
      return { s: sigla(s), bid, ask, mid: (bid > 0 && ask > 0 && ask < 100) ? (bid + ask) / 2 : null };
    });
    if (e.some(v => !v.s || v.mid === null)) return;
    out.push({ d, t: ev.event_ticker, e });
  });
  return out;
}
async function bajarKalshi(serie) {
  let eventos = [], cursor = '';
  for (let i = 0; i < 4; i++) {
    const j = await pedir(KALSHI + '/events?series_ticker=' + serie + '&status=open&with_nested_markets=true&limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!j) break; eventos = eventos.concat(j.events || []); cursor = j.cursor || ''; if (!cursor) break;
  }
  return parsearKalshi(eventos);
}
/* busca el juego de Kalshi de un partido de ESPN (mismo día del Este y mismas siglas) → [centavos local, centavos visita] (punto medio) */
function kalshiDe(lista, juego) {
  const d = diaET(juego.ts), h = sigla(juego.h.ab), a = sigla(juego.a.ab);
  for (const k of lista || []) {
    if (k.d !== d) continue;
    const x = k.e[0], y = k.e[1];
    if (x.s === h && y.s === a) return [x.mid, y.mid];
    if (x.s === a && y.s === h) return [y.mid, x.mid];
  }
  return null;
}

/* ---------- tenis en Kalshi ----------
   Cada partido es un evento con dos mercados («gana X»). Se guarda como un ganador de dos lados con cuotas americanas
   equivalentes a COMPRAR en Kalshi con la comisión incluida: así el rendimiento medido es el que pagarías de verdad. */
function cuotaKalshi(centavos) {
  const x = centavos / 100; if (!(x > 0 && x < 1)) return null;
  const p = Math.min(0.995, x + KALSHI_COMISION * x * (1 - x));
  return Math.round(p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p);
}
function parsearTenis(eventos, serie) {
  const out = [];
  (eventos || []).forEach(ev => {
    const ms = (ev.markets || []).filter(m => m && (m.status === 'active' || m.status === 'open')).sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
    if (ms.length !== 2) return;
    const lado = m => ({ ab: String(m.ticker || '').split('-').pop(), n: m.yes_sub_title || '', bid: dolares(m, 'yes_bid'), ask: dolares(m, 'yes_ask') });
    const h = lado(ms[0]), a = lado(ms[1]);
    const ts = Date.parse(ms[0].occurrence_datetime || ms[0].expected_expiration_time || '');
    if (!isFinite(ts) || !h.n || !a.n) return;
    const r = { id: String(ev.event_ticker), dep: 'tenis', liga: TENIS[serie] || 'Tenis', ts, h: { ab: h.ab, n: h.n }, a: { ab: a.ab, n: a.n }, c: null };
    const sano = x => x.ask > 0 && x.ask < 100 && x.bid > 0 && x.ask - x.bid <= KALSHI_SPREAD_MAX;
    if (sano(h) && sano(a)) r.c = [cuotaKalshi(h.ask), cuotaKalshi(a.ask)];
    out.push(r);
  });
  return out;
}
async function bajarTenis(serie) {
  let eventos = [], cursor = '';
  for (let i = 0; i < 4; i++) {
    const j = await pedir(KALSHI + '/events?series_ticker=' + serie + '&status=open&with_nested_markets=true&limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (!j) break; eventos = eventos.concat(j.events || []); cursor = j.cursor || ''; if (!cursor) break;
  }
  return parsearTenis(eventos, serie);
}
/* resultado de un partido de Kalshi: {fin, ganador: 0 (el primero) | 1 | null, nulo: retiro o partido no jugado} */
function parsearResultadoTenis(j) {
  const ms = ((j && (j.event && j.event.markets || j.markets)) || []).slice().sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  if (ms.length !== 2) return { fin: false };
  const hecho = ms.every(m => /settled|finalized|determined/.test(m.status || ''));
  if (!hecho) return { fin: false };
  const res = ms.map(m => m.result);
  if (res[0] === 'yes' && res[1] === 'no') return { fin: true, ganador: 0 };
  if (res[0] === 'no' && res[1] === 'yes') return { fin: true, ganador: 1 };
  return { fin: true, ganador: null, nulo: true };       /* «scalar»: retiro o se pagó a precio justo */
}
async function bajarResultadoTenis(ticker) {
  return parsearResultadoTenis(await pedir(KALSHI + '/events/' + encodeURIComponent(ticker) + '?with_nested_markets=true'));
}

module.exports = { cuotaKalshi, parsearTenis, bajarTenis, parsearResultadoTenis, bajarResultadoTenis, parsearScoreboard, parsearOdds, parsearProps, parsearBox, parsearKalshi, kalshiDe, sigla,
  bajarScoreboard, bajarOdds, bajarProps, bajarNombres, bajarBox, bajarKalshi };
