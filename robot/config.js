'use strict';
/* TIGRE · configuración: ligas que se vigilan y umbrales de cada señal.
   Cambiar un número aquí cambia cuándo salta una señal (se mide igual con cualquier umbral). */

const OT = ' (incl. overtime)';

/* deporte → rutas de ESPN, mercados de props y serie de Kalshi */
const LIGAS = {
  nba: { nombre: 'NBA', ruta: 'basketball/nba', core: 'basketball/leagues/nba', kalshi: 'KXNBAGAME', props: true },
  nhl: { nombre: 'NHL', ruta: 'hockey/nhl', core: 'hockey/leagues/nhl', kalshi: 'KXNHLGAME', props: true },
  nfl: { nombre: 'NFL', ruta: 'football/nfl', core: 'football/leagues/nfl', kalshi: 'KXNFLGAME', props: true, horas: 168, semana: true },
  mlb: { nombre: 'MLB', ruta: 'baseball/mlb', core: 'baseball/leagues/mlb', kalshi: 'KXMLBGAME', props: false },
  /* universitarios: mercados más blandos que los profesionales y muchos juegos (las señales se miden más rápido). Sin props ni Kalshi */
  ncaaf: { nombre: 'NCAA Football', ruta: 'football/college-football', core: 'football/leagues/college-football', grupos: 80, horas: 120, semana: true },
  ncaab: { nombre: 'NCAA Básquet', ruta: 'basketball/mens-college-basketball', core: 'basketball/leagues/mens-college-basketball', grupos: 50 },
  eng: { nombre: 'Premier League', ruta: 'soccer/eng.1', core: 'soccer/leagues/eng.1', futbol: true, horas: 144, rango: true },
  esp: { nombre: 'La Liga', ruta: 'soccer/esp.1', core: 'soccer/leagues/esp.1', futbol: true, horas: 144, rango: true },
  ita: { nombre: 'Serie A', ruta: 'soccer/ita.1', core: 'soccer/leagues/ita.1', futbol: true, horas: 144, rango: true },
  ger: { nombre: 'Bundesliga', ruta: 'soccer/ger.1', core: 'soccer/leagues/ger.1', futbol: true, horas: 144, rango: true },
  fra: { nombre: 'Ligue 1', ruta: 'soccer/fra.1', core: 'soccer/leagues/fra.1', futbol: true, horas: 144, rango: true },
  ucl: { nombre: 'Champions', ruta: 'soccer/uefa.champions', core: 'soccer/leagues/uefa.champions', futbol: true, horas: 144, rango: true },
  uel: { nombre: 'Europa League', ruta: 'soccer/uefa.europa', core: 'soccer/leagues/uefa.europa', futbol: true, horas: 144, rango: true },
  mls: { nombre: 'MLS', ruta: 'soccer/usa.1', core: 'soccer/leagues/usa.1', futbol: true, horas: 144, rango: true },
  mex: { nombre: 'Liga MX', ruta: 'soccer/mex.1', core: 'soccer/leagues/mex.1', futbol: true, horas: 144, rango: true }
};

/* tenis: ESPN no trae cuotas, así que la fuente es Kalshi (precio de compra con comisión) y su resultado */
const TENIS = { KXATPMATCH: 'Tenis ATP', KXWTAMATCH: 'Tenis WTA', KXATPCHALLENGERMATCH: 'Challenger', KXCHALLENGERMATCH: 'Challenger', KXDAVISCUPMATCH: 'Copa Davis' };
const KALSHI_COMISION = 0.07;     /* comisión estimada de Kalshi: 7% × p × (1 − p) por contrato */
const KALSHI_SPREAD_MAX = 8;      /* si compra y venta están a más de 8¢, el precio es poco confiable y no se anota */

/* props de jugador que se siguen (nombres tal como los trae ESPN/DraftKings; los mismos que usa OVA) */
const PROPS = {
  nba: [
    { k: 'pts', t: 'Total Points', m: 'Points Milestones', n: 'Puntos', box: b => b.points },
    { k: 'reb', t: 'Total Rebounds', m: 'Rebounds Milestones', n: 'Rebotes', box: b => b.rebounds },
    { k: 'ast', t: 'Total Assists', m: 'Assists Milestones', n: 'Asistencias', box: b => b.assists },
    { k: 'tri', t: 'Total 3-Point Field Goals', m: '3-Point Field Goals Milestones', n: 'Triples', box: b => b['threePointFieldGoalsMade-threePointFieldGoalsAttempted'] },
    { k: 'pra', t: 'Total Points, Rebounds, and Assists', m: 'Points + Assists + Rebounds Milestones', n: 'Pts+Reb+Ast', box: b => (b.points == null ? null : b.points + (b.rebounds || 0) + (b.assists || 0)) }],
  nhl: [
    { k: 'pts', t: 'Total Points', m: 'Points Milestones', n: 'Puntos', box: b => (b.goals == null && b.assists == null ? null : (b.goals || 0) + (b.assists || 0)) },
    { k: 'sog', t: 'Total Shots on Goal', m: 'Shots on Goal Milestones', n: 'Tiros a puerta', box: b => b.shotsTotal },
    { k: 'sav', t: 'Total Saves', m: 'Goalkeeper Saves Milestones', n: 'Atajadas', box: b => b.saves }],
  nfl: [
    { k: 'pyd', t: 'Total Passing Yards' + OT, m: 'Passing Yards Milestones', n: 'Yardas de pase', box: b => b.passingYards },
    { k: 'ryd', t: 'Total Rushing Yards' + OT, m: 'Rushing Yards Milestones', n: 'Yardas por tierra', box: b => b.rushingYards },
    { k: 'cyd', t: 'Total Receiving Yards' + OT, m: 'Receiving Yards Milestones', n: 'Yardas de recepción', box: b => b.receivingYards },
    { k: 'rec', t: 'Total Receptions' + OT, m: 'Receptions Milestones', n: 'Recepciones', box: b => b.receptions }]
};

/* Umbrales de señal.
   ml  = puntos de probabilidad (sin margen) del ganador.
   sp / tot = puntos de LÍNEA (hándicap y total); si la línea no se mueve, cuenta el precio (ver precio).
   precio = puntos de probabilidad cuando la línea es la misma (por ejemplo −110 → −135 en el mismo total).
   rapido = movimiento en las últimas 2 horas · acumulado = desde la apertura de la casa.
   fijo = la línea de hándicap casi siempre es ±1.5 (NHL, MLB): si solo cambia de lado es que cambió el favorito,
          eso ya lo cuenta el ganador y no se repite como señal de hándicap. */
const UMBRAL = {
  nba: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 1, acumulado: 1.5 }, tot: { rapido: 1.5, acumulado: 2.5 }, precio: 6, prop: { linea: 1, precio: 8 } },
  nhl: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 0.5, acumulado: 0.5, fijo: true }, tot: { rapido: 0.5, acumulado: 0.5 }, precio: 6, prop: { linea: 0.5, precio: 8 } },
  nfl: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 1, acumulado: 1.5 }, tot: { rapido: 1, acumulado: 2 }, precio: 6, prop: { linea: 5, precio: 8 } },
  ncaaf: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 1, acumulado: 1.5 }, tot: { rapido: 1.5, acumulado: 2.5 }, precio: 6, prop: { linea: 5, precio: 8 } },
  ncaab: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 1, acumulado: 1.5 }, tot: { rapido: 1.5, acumulado: 2.5 }, precio: 6, prop: { linea: 1, precio: 8 } },
  mlb: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 0.5, acumulado: 0.5, fijo: true }, tot: { rapido: 0.5, acumulado: 0.5 }, precio: 6, prop: { linea: 0.5, precio: 8 } },
  tenis: { ml: { rapido: 4, acumulado: 6 }, sp: { rapido: 1, acumulado: 1 }, tot: { rapido: 1, acumulado: 1 }, precio: 6, prop: { linea: 1, precio: 8 } },
  futbol: { ml: { rapido: 3, acumulado: 5 }, sp: { rapido: 0.5, acumulado: 0.5 }, tot: { rapido: 0.5, acumulado: 0.5 }, precio: 6, prop: { linea: 0.5, precio: 8 } }
};
/* Kalshi contra DraftKings: puntos de probabilidad de diferencia en el ganador */
const KALSHI_DIF = 4;
/* ventanas */
const HORAS_ADELANTE = 36;     // se fotografían los juegos que empiezan en las próximas 36 h (NFL, NCAA Football y fútbol: toda la semana, ver «horas»)
const HORAS_PROPS = 14;        // los props solo en las últimas 14 h antes del juego (antes casi no hay)
const HORAS_RAPIDO = 2;        // «movimiento rápido» = en las últimas 2 h

function umbral(dep) { return UMBRAL[dep] || UMBRAL.futbol; }
function horas(dep) { return (LIGAS[dep] && LIGAS[dep].horas) || HORAS_ADELANTE; }

module.exports = { TENIS, KALSHI_COMISION, KALSHI_SPREAD_MAX, LIGAS, PROPS, UMBRAL, KALSHI_DIF, HORAS_ADELANTE, HORAS_PROPS, HORAS_RAPIDO, umbral, horas };
