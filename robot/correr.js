'use strict';
/* ===================================================================
   TIGRE · ROBOT (GitHub Actions cada 30 min: .github/workflows/tigre.yml)
   Uso: node robot/correr.js <carpeta de datos>   (la carpeta es la rama «datos»)

   En cada vuelta:
     1. Fotografía las líneas de DraftKings (vía ESPN) de los juegos de las próximas 36 h:
        ganador, hándicap, total y props de jugador (NBA, NHL, NFL), más el precio de Kalshi.
     2. Busca señales (movimiento rápido, movimiento desde la apertura, Kalshi contra la casa).
     3. Cuando un juego termina: guarda el cierre, resuelve las señales y la calibración.
     4. Arma las tablas de medición y lo que lee la página. Una vez al día, el estudio histórico.
     5. Avisa al teléfono (ntfy) las señales nuevas.
   =================================================================== */
const fs = require('fs'), path = require('path');
const L = require('./lib.js'), C = require('./config.js'), F = require('./fuentes.js'), R = require('./registro.js'), M = require('./medir.js'), H = require('./historia.js');

const HORA = 36e5, DIA = 24 * HORA;
const DIR = process.argv[2] || 'datos';
const AHORA = process.env.TIGRE_AHORA ? Date.parse(process.env.TIGRE_AHORA) : Date.now();
const DIAG = { errores: [], pedidos: 0 };
const PAGINA = 'https://osvaldoalvarez0113-source.github.io/TIGRE/';

function leer(f, def) { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return def; } }
function escribir(f, obj) {
  const p = path.join(DIR, f); fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + '.tmp', JSON.stringify(obj)); fs.renameSync(p + '.tmp', p);
}
const err = (donde, e) => { DIAG.errores.push(donde + ': ' + (e && e.message || e)); };

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const estado = leer('estado.json', { corridas: 0, vistas: {}, nombres: {}, historiaTs: 0 });
  const primera = !estado.corridas;
  let senales = leer('senales.json', []);
  let calib = leer('calibracion.json', []);

  /* ---------- 1. juegos de ayer, hoy y mañana (día del Este) ---------- */
  const dias = [AHORA - DIA, AHORA, AHORA + DIA].map(L.diaET);
  const archivos = {};                                  /* dia → {id: juego} */
  dias.forEach(d => { archivos[d] = leer('juegos/' + d + '.json', {}); });
  const juegoPorId = {};
  Object.values(archivos).forEach(a => Object.values(a).forEach(j => { juegoPorId[j.id] = j; }));

  const eventos = [];
  const tareasSb = [];
  Object.keys(C.LIGAS).forEach(dep => [AHORA - DIA, AHORA, AHORA + DIA].forEach(ts => tareasSb.push(async () => {
    try { DIAG.pedidos++; return await F.bajarScoreboard(dep, ts); } catch (e) { err('marcador ' + dep, e); return []; }
  })));
  (await L.pool(tareasSb, 8)).forEach(l => (l || []).forEach(ev => eventos.push(ev)));
  const vistos = new Set();
  eventos.forEach(ev => {
    if (vistos.has(ev.id)) return; vistos.add(ev.id);
    const d = L.diaET(ev.ts); if (!archivos[d]) return;      /* fuera de la ventana */
    let j = juegoPorId[ev.id];
    if (!j) { j = R.nuevoJuego(ev, C.LIGAS[ev.dep].nombre); juegoPorId[ev.id] = j; }
    /* si ESPN movió el juego de día, se cambia de archivo */
    Object.keys(archivos).forEach(k => { if (k !== d && archivos[k][j.id]) delete archivos[k][j.id]; });
    archivos[d][j.id] = j;
    R.actualizarMeta(j, ev);
  });
  const juegos = Object.values(archivos).reduce((a, x) => a.concat(Object.values(x)), []);

  /* ---------- 2. fotos de las líneas ---------- */
  const porFoto = juegos.filter(j => j.st === 'pre' && !j.cancel && j.ts > AHORA - 10 * 60e3 && j.ts - AHORA <= C.HORAS_ADELANTE * HORA);
  await L.pool(porFoto.map(j => async () => {
    const lg = C.LIGAS[j.dep];
    try {
      DIAG.pedidos++;
      const o = await F.bajarOdds(j.dep, j.id); if (!o) return;
      if (o.ml) R.anotar(j, 'ml', 'ml', AHORA, { c: o.ml.ahora }, o.ml.abre ? { c: o.ml.abre } : null);
      if (o.sp) R.anotar(j, 'sp', 'sp', AHORA, o.sp.ahora, o.sp.abre);
      if (o.tot) R.anotar(j, 'tot', 'tot', AHORA, o.tot.ahora, o.tot.abre);
    } catch (e) { err('cuotas ' + j.dep + ' ' + j.id, e); }
    if (lg.props && j.ts - AHORA <= C.HORAS_PROPS * HORA) {
      try {
        DIAG.pedidos++;
        const ps = await F.bajarProps(j.dep, j.id);
        Object.keys(ps).forEach(k => { const p = ps[k]; R.anotar(j, 'p:' + k, 'prop', AHORA, p.ahora, p.abre || null, { ath: p.ath, k: p.k }); });
      } catch (e) { err('props ' + j.dep + ' ' + j.id, e); }
    }
  }), 8);

  /* nombres de los jugadores con props (una sola vez por atleta) */
  const faltanNombres = {};
  juegos.forEach(j => Object.values(j.m).forEach(m => { if (m.t === 'prop' && !estado.nombres[m.ath]) (faltanNombres[j.dep] = faltanNombres[j.dep] || new Set()).add(m.ath); }));
  for (const dep of Object.keys(faltanNombres)) {
    const ids = [...faltanNombres[dep]].slice(0, 250); DIAG.pedidos += ids.length;
    Object.assign(estado.nombres, await F.bajarNombres(dep, ids));
  }
  juegos.forEach(j => Object.values(j.m).forEach(m => { if (m.t === 'prop' && !m.n && estado.nombres[m.ath]) m.n = estado.nombres[m.ath]; }));

  /* Kalshi: ganador de NBA, NHL, NFL y MLB */
  for (const dep of Object.keys(C.LIGAS)) {
    const serie = C.LIGAS[dep].kalshi; if (!serie || !porFoto.some(j => j.dep === dep)) continue;
    try {
      DIAG.pedidos++;
      const lista = await F.bajarKalshi(serie);
      porFoto.filter(j => j.dep === dep).forEach(j => { const k = F.kalshiDe(lista, j); if (k) R.anotar(j, 'k', 'k', AHORA, { c: k }, null); });
    } catch (e) { err('kalshi ' + dep, e); }
  }

  /* ---------- 3. señales ---------- */
  const nuevas = [];
  juegos.forEach(j => R.detectar(j, AHORA).forEach(s => {
    if (estado.vistas[s.clave]) return;
    estado.vistas[s.clave] = AHORA;
    const r = R.registroSenal(j, s, AHORA, j.liga);
    r.primera = primera || undefined;
    senales.push(r); nuevas.push(r);
  }));

  /* ---------- 4. juegos empezados y terminados ---------- */
  for (const j of juegos) {
    if (j.st !== 'pre' && Object.keys(j.m).length) R.fijarCierre(j);
    if (!j.fin || j.resuelto) continue;
    let box = null;
    const hayProps = Object.values(j.m).some(m => m.t === 'prop');
    if (hayProps) { try { DIAG.pedidos++; box = await F.bajarBox(j.dep, j.id); } catch (e) { err('boxscore ' + j.id, e); continue; } }
    if (hayProps && (!box || !Object.keys(box).length)) { err('boxscore vacío', j.id); continue; }   /* se reintenta en la próxima vuelta */
    M.resolverSenales(senales, j, box);
    calib = calib.concat(M.filasCalibracion(j, box));
    j.resuelto = AHORA;
  }

  /* ---------- 5. guardar juegos (los de días viejos ya resueltos no se vuelven a abrir) ---------- */
  Object.keys(archivos).forEach(d => escribir('juegos/' + d + '.json', archivos[d]));
  /* señales de juegos fuera de la ventana que siguen sin resolver: se miran sus archivos */
  const pendientes = senales.filter(s => !s.res && !juegoPorId[s.jid] && AHORA - s.ts < 5 * DIA);
  const diasPend = [...new Set(pendientes.map(s => L.diaET(s.ts)))];
  for (const d of diasPend) {
    const a = leer('juegos/' + d + '.json', null); if (!a) continue;
    let cambio = false;
    for (const s of pendientes.filter(x => L.diaET(x.ts) === d)) {
      const j = a[s.jid]; if (!j || j.resuelto) continue;
      try {
        const evs = await F.bajarScoreboard(j.dep, j.ts); DIAG.pedidos++;
        const ev = evs.find(e => e.id === j.id); if (!ev) continue;
        R.actualizarMeta(j, ev); if (j.st !== 'pre') R.fijarCierre(j);
        if (!j.fin) continue;
        const hayProps = Object.values(j.m).some(m => m.t === 'prop');
        const box = hayProps ? await F.bajarBox(j.dep, j.id) : null;
        M.resolverSenales(senales, j, box); calib = calib.concat(M.filasCalibracion(j, box)); j.resuelto = AHORA; cambio = true;
      } catch (e) { err('pendiente ' + s.jid, e); }
    }
    if (cambio) escribir('juegos/' + d + '.json', a);
  }
  /* las señales de juegos suspendidos o que nunca se jugaron se cierran como nulas a los 5 días */
  senales.forEach(s => { if (!s.res && AHORA - s.ts > 5 * DIA) s.res = 'nula'; });

  /* ---------- 6. medición ---------- */
  const tab = M.tablas(senales, calib);
  tab.generado = new Date(AHORA).toISOString();

  /* ---------- 7. estudio histórico (una vez al día, con el archivo de cierres de ODDX) ---------- */
  let hist = leer('historia.json', null);
  if (!hist || AHORA - (estado.historiaTs || 0) > 20 * HORA) {
    try {
      let todos = [];
      for (const dep of ['nba', 'nhl', 'nfl', 'mlb']) {
        DIAG.pedidos++;
        const a = await L.pedir('https://raw.githubusercontent.com/osvaldoalvarez0113-source/ODDX/cierres/cierres-' + dep + '.json');
        if (a) todos = todos.concat(H.juegosDeCierres(dep, a));
      }
      if (todos.length) { hist = H.estudiar(todos); hist.generado = new Date(AHORA).toISOString(); estado.historiaTs = AHORA; }
    } catch (e) { err('historia', e); }
  }

  /* ---------- 8. lo que lee la página ---------- */
  const visibles = juegos.filter(j => j.ts > AHORA - 14 * HORA && j.ts - AHORA <= C.HORAS_ADELANTE * HORA && Object.keys(j.m).length)
    .sort((a, b) => a.ts - b.ts).map(j => resumenJuego(j, senales));
  escribir('hoy.json', { generado: new Date(AHORA).toISOString(), juegos: visibles });
  escribir('senales.json', senales);
  escribir('senales-recientes.json', senales.filter(s => AHORA - s.t < 4 * DIA).sort((a, b) => b.t - a.t));
  escribir('calibracion.json', calib);
  escribir('medicion.json', tab);
  if (hist) escribir('historia.json', hist);

  /* ---------- 9. avisos ---------- */
  const avisables = nuevas.filter(s => s.mt !== 'prop' || s.nivel >= 2);
  let aviso = 'sin avisos';
  if (!primera && avisables.length && process.env.NTFY_TOPIC) aviso = await avisar(avisables);
  else if (primera) aviso = 'primera vuelta: no se avisa (todas las señales serían de golpe)';
  else if (!process.env.NTFY_TOPIC && avisables.length) aviso = 'falta el secreto NTFY_TOPIC';

  /* ---------- 10. estado ---------- */
  Object.keys(estado.vistas).forEach(k => { if (AHORA - estado.vistas[k] > 10 * DIA) delete estado.vistas[k]; });
  estado.corridas = (estado.corridas || 0) + 1;
  estado.ultima = new Date(AHORA).toISOString();
  estado.ultimaVuelta = { juegos: juegos.length, fotografiados: porFoto.length, senalesNuevas: nuevas.length, pedidos: DIAG.pedidos, errores: DIAG.errores.slice(0, 20), aviso };
  escribir('estado.json', estado);

  console.log('TIGRE ' + estado.ultima + ' · juegos ' + juegos.length + ' · fotografiados ' + porFoto.length + ' · mercados ' + porFoto.reduce((a, j) => a + Object.keys(j.m).length, 0) +
    ' · señales nuevas ' + nuevas.length + ' · señales en total ' + senales.length + ' (resueltas ' + senales.filter(s => s.res).length + ') · calibración ' + calib.length + ' · pedidos ' + DIAG.pedidos + ' · aviso: ' + aviso);
  nuevas.slice(0, 25).forEach(s => console.log('  ' + s.liga + ' ' + s.partido + ' · ' + s.tipo + ' · ' + s.txt + ' · ' + s.desc + ' · ' + s.mag + ' ' + s.unidad));
  if (DIAG.errores.length) { console.log('errores: ' + DIAG.errores.length); DIAG.errores.slice(0, 15).forEach(e => console.log('  ' + e)); }
}

/* juego compacto para la página: apertura, ahora, serie corta y señales */
function resumenJuego(j, senales) {
  const mk = {};
  Object.keys(j.m).forEach(k => {
    const m = j.m[k], u = R.ultima(m); if (!u) return;
    const pa = R.probs(m.t, u.c), abre = m.abre || (m.serie[0] ? { c: m.serie[0][1], l: m.serie[0][2] } : null), po = abre ? R.probs(m.t, abre.c) : null;
    const x = { t: m.t, ahora: { c: u.c, l: u.l }, abre: abre ? { c: abre.c, l: abre.l } : null, p: pa && pa.map(v => +v.toFixed(3)), po: po && po.map(v => +v.toFixed(3)) };
    if (m.t !== 'prop') {
      const s = m.serie, paso = Math.max(1, Math.ceil(s.length / 30));
      x.serie = s.filter((e, i) => i % paso === 0 || i === s.length - 1).map(e => { const p = R.probs(m.t, e[1]); return [e[0], p ? +p[0].toFixed(3) : null, e[2]]; });
    }
    if (m.t === 'prop') { x.n = m.n || ''; x.k = m.k; if (abre && abre.l === u.l && po && pa && Math.abs(pa[0] - po[0]) < 0.04) return; if (!abre) return; }
    mk[k] = x;
  });
  const sj = senales.filter(s => s.jid === j.id).map(s => ({ id: s.id, tipo: s.tipo, txt: s.txt, desc: s.desc, mag: s.mag, unidad: s.unidad, nivel: s.nivel, t: s.t, c: s.c, res: s.res || null }));
  return { id: j.id, dep: j.dep, liga: j.liga, ts: j.ts, st: j.st, det: j.det, h: j.h, a: j.a, hs: j.hs, as: j.as, m: mk, senales: sj };
}

async function avisar(lista) {
  const hora = ts => new Date(ts).toLocaleTimeString('es-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  const ic = { rapido: '⚡', acumulado: '📈', kalshi: '🔀' };
  const lineas = lista.slice(0, 10).map(s => ic[s.tipo] + ' ' + s.liga + ' ' + s.partido + ' (' + hora(s.ts) + ')\n   ' + s.txt + ' · ' + s.desc);
  if (lista.length > 10) lineas.push('… y ' + (lista.length - 10) + ' más en la página');
  try {
    const titulo = 'TIGRE: ' + lista.length + (lista.length === 1 ? ' señal nueva' : ' señales nuevas');
    const u = 'https://ntfy.sh/' + encodeURIComponent(process.env.NTFY_TOPIC) + '?title=' + encodeURIComponent(titulo) + '&tags=tiger&click=' + encodeURIComponent(PAGINA);
    const r = await fetch(u, { method: 'POST', body: lineas.join('\n') });
    return r.ok ? 'enviado (' + lista.length + ')' : 'ntfy HTTP ' + r.status;
  } catch (e) { return 'ntfy falló: ' + e.message; }
}

main().catch(e => { console.error('TIGRE: ERROR ' + (e && e.stack || e)); process.exit(1); });
