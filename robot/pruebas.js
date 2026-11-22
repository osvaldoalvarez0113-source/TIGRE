'use strict';
/* TIGRE · pruebas sin red (node robot/pruebas.js). Si algo falla, el robot no corre. */
const assert = require('assert');
const L = require('./lib.js'), F = require('./fuentes.js'), R = require('./registro.js'), M = require('./medir.js'), H = require('./historia.js');
let ok = 0; const t = (n, f) => { try { f(); ok++; } catch (e) { console.log('✗ ' + n + ': ' + e.message); process.exitCode = 1; } };
const HORA = 36e5;

t('cuotas americanas y sin margen', () => {
  assert.strictEqual(L.am('+150'), 150); assert.strictEqual(L.am('-110'), -110); assert.strictEqual(L.am('EVEN'), 100); assert.strictEqual(L.am('50'), null);
  const p = L.sinMargen([-110, -110]); assert.ok(Math.abs(p[0] - 0.5) < 1e-9);
  assert.ok(Math.abs(L.dec(-200) - 1.5) < 1e-9); assert.ok(Math.abs(L.dec(150) - 2.5) < 1e-9);
  assert.strictEqual(L.ganancia(-200, 'gana'), 0.5); assert.strictEqual(L.ganancia(150, 'pierde'), -1); assert.strictEqual(L.ganancia(150, 'push'), 0);
});

/* respuesta real de ESPN (recortada) del Heat-Thunder del 22 nov 2026 */
const ODDS_NBA = { items: [{ provider: { id: '100', name: 'Draft Kings' }, overUnder: 226.5, spread: -4.5, overOdds: -110, underOdds: -110,
  awayTeamOdds: { moneyLine: 162, spreadOdds: -106, open: { pointSpread: { american: '+2.5' }, spread: { american: '-115' }, moneyLine: { american: '+117' } }, current: { pointSpread: { american: '+4.5' }, spread: { american: '-106' }, moneyLine: { american: '+162' } } },
  homeTeamOdds: { moneyLine: -194, spreadOdds: -114, open: { pointSpread: { american: '-2.5' }, spread: { american: '-105' }, moneyLine: { american: '-139' } }, current: { pointSpread: { american: '-4.5' }, spread: { american: '-114' }, moneyLine: { american: '-194' } } },
  open: { over: { american: '-110' }, under: { american: '-110' }, total: { american: '231.5' } }, current: { over: { american: '-110' }, under: { american: '-110' }, total: { american: '226.5' } } }] };
t('leer cuotas de ESPN (apertura y actual)', () => {
  const o = F.parsearOdds(ODDS_NBA, false);
  assert.deepStrictEqual(o.ml, { ahora: [-194, 162], abre: [-139, 117] });
  assert.deepStrictEqual(o.sp, { ahora: { c: [-114, -106], l: -4.5 }, abre: { c: [-105, -115], l: -2.5 } });
  assert.deepStrictEqual(o.tot, { ahora: { c: [-110, -110], l: 226.5 }, abre: { c: [-110, -110], l: 231.5 } });
});
t('fútbol: ganador de tres salidas con el empate en el medio', () => {
  const j = JSON.parse(JSON.stringify(ODDS_NBA)); j.items[0].drawOdds = { moneyLine: 340 };
  const o = F.parsearOdds(j, true);
  assert.deepStrictEqual(o.ml.ahora, [-194, 340, 162]); assert.strictEqual(o.ml.abre, null);
});

const it = (ath, tipo, linea, cuota, lineaA, cuotaA) => ({ athlete: { $ref: 'x/athletes/' + ath + '?lang=en' }, type: { name: tipo }, odds: { american: { value: String(cuota), open: String(cuotaA) } }, current: { target: { value: linea } }, open: { target: { value: lineaA } } });
t('props: Más y Menos con el hito', () => {
  /* el hito 15+ cuesta −120, parecido a −118 → el −118 es el Más */
  const items = [it(1, 'Total Points', 14.5, -108, 14.5, -117), it(1, 'Total Points', 14.5, -118, 14.5, -109), it(1, 'Points Milestones', 15, -120, 15, -120)];
  const p = F.parsearProps(items, 'nba')['1|pts'];
  assert.deepStrictEqual(p.ahora, { c: [-118, -108], l: 14.5 });
  assert.deepStrictEqual(p.abre, { c: [-109, -117], l: 14.5 });
});
t('props: se queda con la línea más pareja', () => {
  const items = [it(2, 'Total Rebounds', 6.5, -200, 6.5, -200), it(2, 'Total Rebounds', 6.5, 160, 6.5, 160), it(2, 'Total Rebounds', 7.5, -110, 7.5, -110), it(2, 'Total Rebounds', 7.5, -110, 7.5, -110)];
  assert.strictEqual(F.parsearProps(items, 'nba')['2|reb'].ahora.l, 7.5);
});
t('boxscore → valores de props', () => {
  const sum = { boxscore: { players: [{ statistics: [{ keys: ['minutes', 'points', 'rebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'], athletes: [{ athlete: { id: '7' }, stats: ['33', '25', '8', '4', '3-7'] }, { athlete: { id: '8' }, didNotPlay: true, stats: [] }] }] }] } };
  const b = F.parsearBox(sum, 'nba');
  assert.deepStrictEqual(b['7'], { pts: 25, reb: 8, ast: 4, tri: 3, pra: 37 }); assert.strictEqual(b['8'], undefined);
});
t('Kalshi: siglas y punto medio', () => {
  const evs = [{ event_ticker: 'KXNBAGAME-26NOV22OKCMIA', markets: [{ ticker: 'KXNBAGAME-26NOV22OKCMIA-OKC', status: 'active', yes_bid_dollars: '0.36', yes_ask_dollars: '0.38' }, { ticker: 'KXNBAGAME-26NOV22OKCMIA-MIA', status: 'active', yes_bid_dollars: '0.62', yes_ask_dollars: '0.64' }] }];
  const l = F.parsearKalshi(evs);
  const j = { ts: Date.parse('2026-11-23T00:30:00Z'), h: { ab: 'MIA' }, a: { ab: 'OKC' } };
  assert.deepStrictEqual(F.kalshiDe(l, j), [63, 37]);
  assert.strictEqual(F.sigla('GSW'), 'GS');
});

/* juego de prueba que empieza en 5 horas */
const T0 = Date.parse('2026-11-22T18:00:00Z');
function juego() { return R.nuevoJuego({ id: '9', dep: 'nba', ts: T0 + 5 * HORA, st: 'pre', fin: false, h: { ab: 'MIA', n: 'Heat' }, a: { ab: 'OKC', n: 'Thunder' }, hs: null, as: null }, 'NBA'); }
t('registro: solo anota cuando cambia', () => {
  const j = juego();
  R.anotar(j, 'ml', 'ml', T0, { c: [-139, 117] }, { c: [-139, 117] });
  R.anotar(j, 'ml', 'ml', T0 + 30 * 60e3, { c: [-139, 117] });
  R.anotar(j, 'ml', 'ml', T0 + 60 * 60e3, { c: [-160, 135] });
  assert.strictEqual(j.m.ml.serie.length, 2); assert.strictEqual(j.m.ml.visto, T0 + 60 * 60e3);
});
t('detector: ganador que se mueve desde la apertura y rápido', () => {
  const j = juego();
  R.anotar(j, 'ml', 'ml', T0, { c: [-139, 117] }, { c: [-139, 117] });
  R.anotar(j, 'ml', 'ml', T0 + 3 * HORA, { c: [-194, 162] });
  const s = R.detectar(j, T0 + 3 * HORA);
  const acu = s.find(x => x.tipo === 'acumulado'), rap = s.find(x => x.tipo === 'rapido');
  assert.ok(acu && acu.lado === 0 && acu.mag > 7 && acu.nivel === 1, JSON.stringify(acu));
  assert.ok(rap && rap.lado === 0 && rap.nivel === 2, JSON.stringify(rap));
});
t('detector: hándicap y total por línea', () => {
  const j = juego();
  R.anotar(j, 'sp', 'sp', T0, { c: [-114, -106], l: -4.5 }, { c: [-105, -115], l: -2.5 });
  R.anotar(j, 'tot', 'tot', T0, { c: [-110, -110], l: 226.5 }, { c: [-110, -110], l: 231.5 });
  const s = R.detectar(j, T0 + 60e3);
  const sp = s.find(x => x.mk === 'sp' && x.tipo === 'acumulado'), tot = s.find(x => x.mk === 'tot' && x.tipo === 'acumulado');
  assert.ok(sp && sp.lado === 0 && sp.mag === 2 && sp.unidad === 'línea');
  assert.ok(tot && tot.lado === 1 && tot.mag === 5);
  const r = R.registroSenal(j, sp, T0 + 60e3, 'NBA');
  assert.strictEqual(r.txt, 'Heat -4.5'); assert.strictEqual(r.l, -4.5); assert.strictEqual(r.c, -114); assert.strictEqual(r.desc, 'línea -2.5 → -4.5');
});
t('detector: no mira juegos empezados ni mercados viejos', () => {
  const j = juego(); R.anotar(j, 'ml', 'ml', T0, { c: [-139, 117] }, { c: [-110, -110] });
  assert.ok(R.detectar(j, T0 + 60e3).length > 0);
  assert.strictEqual(R.detectar(j, T0 + 2 * HORA).length, 0);           /* la foto tiene 2 horas */
  j.st = 'in'; assert.strictEqual(R.detectar(j, T0 + 60e3).length, 0);
});
t('detector: Kalshi contra la casa', () => {
  const j = juego(); R.anotar(j, 'ml', 'ml', T0, { c: [-150, 130] }); R.anotar(j, 'k', 'k', T0, { c: [66, 34] });
  const s = R.detectar(j, T0 + 60e3).find(x => x.tipo === 'kalshi');
  assert.ok(s && s.lado === 0 && s.mag >= 4, JSON.stringify(s));
});
t('resultado de cada mercado', () => {
  const j = { hs: 110, as: 104 };
  assert.strictEqual(M.resultado('ml', 0, null, j), 'gana'); assert.strictEqual(M.resultado('ml', 1, null, j), 'pierde');
  assert.strictEqual(M.resultado('sp', 0, -4.5, j), 'gana'); assert.strictEqual(M.resultado('sp', 1, 4.5, j), 'pierde'); assert.strictEqual(M.resultado('sp', 0, -6, j), 'push');
  assert.strictEqual(M.resultado('tot', 0, 213.5, j), 'gana'); assert.strictEqual(M.resultado('tot', 1, 214, j), 'push');
  const m3 = { serie: [[0, [-120, 250, 300], null]] };
  assert.strictEqual(M.resultado('ml', 1, null, { hs: 1, as: 1 }, null, m3), 'gana'); assert.strictEqual(M.resultado('ml', 0, null, { hs: 1, as: 1 }, null, m3), 'pierde');
  const mp = { ath: '7', k: 'pts' };
  assert.strictEqual(M.resultado('prop', 0, 24.5, j, { 7: { pts: 25 } }, mp), 'gana');
  assert.strictEqual(M.resultado('prop', 0, 24.5, j, { 8: { pts: 25 } }, mp), 'nula');
});
t('CLV: misma línea en puntos, línea distinta en puntos de línea', () => {
  const s = { mt: 'sp', lado: 0, l: -2.5, p: 0.5 };
  assert.deepStrictEqual(M.clv(s, { c: [-110, -110], l: -4.5 }).clvLinea, 2);
  const s2 = { mt: 'tot', lado: 1, l: 231.5, p: 0.5 };
  assert.strictEqual(M.clv(s2, { c: [-110, -110], l: 226.5 }).clvLinea, 5);
  const s3 = { mt: 'ml', lado: 0, l: null, p: 0.55 };
  const c3 = M.clv(s3, { c: [-194, 162], l: null }); assert.ok(c3.clvPts > 5 && c3.clvSigno === 1);
});
t('señal completa: se resuelve con el marcador', () => {
  const j = juego();
  R.anotar(j, 'sp', 'sp', T0, { c: [-114, -106], l: -4.5 }, { c: [-105, -115], l: -2.5 });
  const s = R.detectar(j, T0 + 60e3).find(x => x.mk === 'sp' && x.tipo === 'acumulado');
  const reg = R.registroSenal(j, s, T0 + 60e3, 'NBA'); const lista = [reg];
  j.st = 'post'; j.fin = true; j.hs = 120; j.as = 110; R.fijarCierre(j);
  assert.strictEqual(M.resolverSenales(lista, j, null), 1);
  assert.strictEqual(reg.res, 'gana'); assert.ok(Math.abs(reg.g - (100 / 114)) < 1e-3); assert.strictEqual(reg.gContra, -1);
  const tab = M.tablas(lista, M.filasCalibracion(j, null));
  assert.strictEqual(tab.total.n, 1); assert.strictEqual(tab.total.gana, 100); assert.ok(tab.calibracion.sp);
});
t('historia: ROI temprano, tarde y en contra', () => {
  const js = [{ dep: 'mlb', ml: [-150, 130], mlOpen: [-120, 100], hs: 5, as: 3 }, { dep: 'mlb', ml: [-150, 130], mlOpen: [-120, 100], hs: 2, as: 3 }];
  const r = H.estudiar(js), m = r.todos.movimiento.find(x => x.n === 2);
  assert.strictEqual(m.gana, 50);
  assert.strictEqual(m.roiTemprano, +((100 / 120 - 1) / 2 * 100).toFixed(1));
  assert.strictEqual(m.roiTarde, +((100 / 150 - 1) / 2 * 100).toFixed(1));
  assert.strictEqual(m.roiContra, +((1.3 - 1) / 2 * 100).toFixed(1));
});
t('detector: en NHL el ±1.5 que cambia de lado no es señal de hándicap', () => {
  const j = juego(); j.dep = 'nhl';
  R.anotar(j, 'sp', 'sp', T0, { c: [210, -258], l: -1.5 }, { c: [-225, 185], l: 1.5 });
  assert.strictEqual(R.detectar(j, T0 + 60e3).filter(x => x.mk === 'sp').length, 0);
});
t('cierre oficial de ESPN cuando existe', () => {
  const j = JSON.parse(JSON.stringify(ODDS_NBA)), it0 = j.items[0];
  it0.homeTeamOdds.close = { pointSpread: { american: '-5.5' }, spread: { american: '-110' }, moneyLine: { american: '-210' } };
  it0.awayTeamOdds.close = { pointSpread: { american: '+5.5' }, spread: { american: '-110' }, moneyLine: { american: '+175' } };
  it0.close = { over: { american: '-108' }, under: { american: '-112' }, total: { american: '225.5' } };
  const o = F.parsearOdds(j, false);
  assert.deepStrictEqual(o.cierre, { ml: { c: [-210, 175], l: null }, sp: { c: [-110, -110], l: -5.5 }, tot: { c: [-108, -112], l: 225.5 } });
  assert.strictEqual(F.parsearOdds(ODDS_NBA, false).cierre, undefined);
});
t('veredicto de un tipo de señal', () => {
  assert.strictEqual(M.veredicto({ n: 350, gana: 58, promete: 52, margen: 5, roi: 4, clvFavor: 60 }), 'probada');
  assert.strictEqual(M.veredicto({ n: 350, gana: 55, promete: 52, margen: 5, roi: 4, clvFavor: 60 }), 'prueba');
  assert.strictEqual(M.veredicto({ n: 150, gana: 48, promete: 52, margen: 8, roi: -6, clvFavor: 40 }), 'pierde');
  assert.strictEqual(M.veredicto({ n: 20, gana: 70, promete: 52, margen: 20, roi: 30 }), 'prueba');
});
t('el mismo movimiento que sube de nivel cuenta una vez en el récord', () => {
  const a = { jid: '1', mk: 'ml', tipo: 'rapido', lado: 0, t: 1, nivel: 1 }, b = Object.assign({}, a, { t: 2, nivel: 2 }), c = Object.assign({}, a, { t: 3, lado: 1 });
  assert.deepStrictEqual(M.unicas([b, a, c]), [a, c]);
});
t('tenis en Kalshi: cuota con comisión, partido y resultado', () => {
  assert.strictEqual(F.cuotaKalshi(50), -107);                    /* 50¢ + comisión ≈ 51.75¢ */
  const evs = [{ event_ticker: 'KXATPMATCH-27JAN05SINALC', markets: [
    { ticker: 'KXATPMATCH-27JAN05SINALC-SIN', status: 'active', yes_sub_title: 'Jannik Sinner', yes_bid_dollars: '0.55', yes_ask_dollars: '0.57', occurrence_datetime: '2027-01-05T09:00:00Z' },
    { ticker: 'KXATPMATCH-27JAN05SINALC-ALC', status: 'active', yes_sub_title: 'Carlos Alcaraz', yes_bid_dollars: '0.43', yes_ask_dollars: '0.45', occurrence_datetime: '2027-01-05T09:00:00Z' }] }];
  const p = F.parsearTenis(evs, 'KXATPMATCH')[0];
  assert.strictEqual(p.h.n, 'Carlos Alcaraz'); assert.strictEqual(p.a.n, 'Jannik Sinner'); assert.strictEqual(p.liga, 'Tenis ATP');
  assert.ok(p.c[0] > 100 && p.c[1] < -100, JSON.stringify(p.c));
  const res = F.parsearResultadoTenis({ event: { markets: [{ ticker: 'X-SIN', status: 'finalized', result: 'yes' }, { ticker: 'X-ALC', status: 'finalized', result: 'no' }] } });
  assert.deepStrictEqual(res, { fin: true, ganador: 1 });
  assert.strictEqual(F.parsearResultadoTenis({ markets: [{ ticker: 'A', status: 'finalized', result: 'scalar' }, { ticker: 'B', status: 'finalized', result: 'scalar' }] }).nulo, true);
  /* spread muy abierto: no se anota precio */
  evs[0].markets[0].yes_bid_dollars = '0.30';
  assert.strictEqual(F.parsearTenis(evs, 'KXATPMATCH')[0].c, null);
});
console.log((process.exitCode ? '✗ ' : '✓ ') + ok + ' pruebas pasaron');
