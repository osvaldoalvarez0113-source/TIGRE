'use strict';
/* ===================================================================
   TIGRE · ROBOT (GitHub Actions cada 10 min por el reloj externo: .github/workflows/tigre.yml)
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

  /* ---------- 1. juegos: ayer, hoy y mañana (día del Este); NFL y NCAA Football toda la semana ---------- */
  const archivos = {};                                  /* dia → {id: juego}; se abren a medida que hacen falta */
  const abrir = d => { if (!archivos[d]) archivos[d] = leer('juegos/' + d + '.json', {}); return archivos[d]; };
  for (let i = -1; i <= 7; i++) abrir(L.diaET(AHORA + i * DIA));
  const juegoPorId = {};
  Object.values(archivos).forEach(a => Object.values(a).forEach(j => { juegoPorId[j.id] = j; }));

  const eventos = [];
  const tareasSb = [];
  Object.keys(C.LIGAS).forEach(dep => {
    const dias = [AHORA - DIA, AHORA, AHORA + DIA].concat(C.LIGAS[dep].semana ? [null] : []);
    dias.forEach(ts => tareasSb.push(async () => {
      try { DIAG.pedidos++; return await F.bajarScoreboard(dep, ts); } catch (e) { err('marcador ' + dep, e); return []; }
    }));
    /* fútbol: los partidos de los próximos días (sus líneas se mueven toda la semana) */
    if (C.LIGAS[dep].rango) for (let i = 2; i * DIA <= C.horas(dep) * HORA; i++) tareasSb.push(async () => {   /* ESPN no acepta rangos de fechas: día por día */
      try { DIAG.pedidos++; return await F.bajarScoreboard(dep, AHORA + i * DIA); } catch (e) { err('marcador ' + dep + ' +' + i, e); return []; }
    });
  });
  (await L.pool(tareasSb, 8)).forEach(l => (l || []).forEach(ev => eventos.push(ev)));
  const vistos = new Set();
  eventos.forEach(ev => {
    if (vistos.has(ev.id)) return; vistos.add(ev.id);
    if (!(ev.ts >= AHORA - 1.5 * DIA && ev.ts - AHORA <= C.horas(ev.dep) * HORA)) return;     /* fuera de la ventana */
    const d = L.diaET(ev.ts);
    let j = juegoPorId[ev.id];
    if (!j) { j = R.nuevoJuego(ev, C.LIGAS[ev.dep].nombre); juegoPorId[ev.id] = j; }
    /* si ESPN movió el juego de día, se cambia de archivo */
    Object.keys(archivos).forEach(k => { if (k !== d && archivos[k][j.id]) delete archivos[k][j.id]; });
    abrir(d)[j.id] = j;
    R.actualizarMeta(j, ev);
  });
  /* limpieza única (v1): las primeras fotos de tenis no filtraban mercados sin dinero → se borran esas fotos y sus señales */
  if (!estado.limpiezaTenis) {
    let fotos = 0;
    Object.values(juegoPorId).forEach(j => { if (j.dep === 'tenis' && !j.fin && j.m.ml) { fotos += j.m.ml.serie.length; delete j.m.ml; } });
    const antes = senales.length;
    senales = senales.filter(s => s.dep !== 'tenis' || s.res);
    Object.keys(estado.vistas).forEach(k => { const j = juegoPorId[k.split('|')[0]]; if (j && j.dep === 'tenis') delete estado.vistas[k]; });
    estado.limpiezaTenis = AHORA;
    console.log('limpieza de tenis: ' + fotos + ' fotos y ' + (antes - senales.length) + ' señales borradas');
  }

  /* limpieza única: señales de hándicap ±1.5 de NHL/MLB que solo cambiaron de lado (antes de que se filtraran) */
  if (!estado.limpiezaFlip) {
    const antes = senales.length;
    senales = senales.filter(s => !(!s.res && s.mt === 'sp' && (s.dep === 'nhl' || s.dep === 'mlb') && s.unidad === 'línea' && Math.abs(s.mag - 3) < 0.01));
    estado.limpiezaFlip = AHORA;
    console.log('limpieza ±1.5: ' + (antes - senales.length) + ' señales borradas');
  }

  /* tenis (Kalshi): los partidos se crean desde los mercados abiertos; la foto es el precio de compra con comisión */
  for (const serie of Object.keys(C.TENIS)) {
    let lista = [];
    try { DIAG.pedidos++; lista = await F.bajarTenis(serie); } catch (e) { err('tenis ' + serie, e); continue; }
    lista.forEach(ev => {
      if (!(ev.ts >= AHORA - 1.5 * DIA && ev.ts - AHORA <= C.HORAS_ADELANTE * HORA)) return;
      let j = juegoPorId[ev.id];
      if (!j) { j = R.nuevoJuego({ id: ev.id, dep: 'tenis', ts: ev.ts, st: 'pre', det: '', fin: false, h: ev.h, a: ev.a, hs: null, as: null }, ev.liga); juegoPorId[ev.id] = j; }
      if (j.fin) return;
      const d = L.diaET(ev.ts);
      Object.keys(archivos).forEach(k => { if (k !== d && archivos[k][j.id]) delete archivos[k][j.id]; });
      abrir(d)[j.id] = j;
      j.ts = ev.ts; j.st = AHORA < ev.ts ? 'pre' : 'in';
      if (j.st === 'pre' && ev.c) R.anotar(j, 'ml', 'ml', AHORA, { c: ev.c });
    });
  }
  const juegos = Object.values(archivos).reduce((a, x) => a.concat(Object.values(x)), []);
  juegos.forEach(j => { if (j.dep === 'tenis' && !j.fin && j.st === 'pre' && AHORA >= j.ts) j.st = 'in'; });

  /* ---------- 2. fotos de las líneas ---------- */
  const porFoto = juegos.filter(j => j.dep !== 'tenis' && j.st === 'pre' && !j.cancel && j.ts > AHORA - 10 * 60e3 && j.ts - AHORA <= C.horas(j.dep) * HORA);
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
    if (j.st !== 'pre' && Object.keys(j.m).length && !j.cierre && j.dep === 'tenis') R.fijarCierre(j);
    if (j.dep === 'tenis') {
      if (!j.resuelto && AHORA - j.ts > 45 * 60e3) { const r = await resolverTenis(j, senales); if (r) calib = calib.concat(r); }
      continue;
    }
    if (j.st !== 'pre' && Object.keys(j.m).length && !j.cierre) {
      R.fijarCierre(j);
      /* si ESPN ya trae el cierre oficial de DraftKings, ese manda (la última foto puede tener hasta 10 min o más) */
      try {
        DIAG.pedidos++;
        const o = await F.bajarOdds(j.dep, j.id);
        if (o && o.cierre) {
          j.cierreFoto = {};                                       /* se guarda la foto propia para comparar con el cierre de ESPN */
          Object.keys(o.cierre).forEach(k => { if (j.m[k]) { if (j.cierre[k]) j.cierreFoto[k] = j.cierre[k]; j.cierre[k] = Object.assign({ t: AHORA, oficial: true }, o.cierre[k]); } });
        }
      } catch (e) { err('cierre ' + j.id, e); }
    }
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
  Object.keys(archivos).forEach(d => { if (Object.keys(archivos[d]).length) escribir('juegos/' + d + '.json', archivos[d]); });
  /* señales de juegos fuera de la ventana que siguen sin resolver: se miran sus archivos */
  const pendientes = senales.filter(s => !s.res && !juegoPorId[s.jid] && AHORA - s.ts < 5 * DIA);
  const diasPend = [...new Set(pendientes.map(s => L.diaET(s.ts)))];
  for (const d of diasPend) {
    const a = leer('juegos/' + d + '.json', null); if (!a) continue;
    let cambio = false;
    for (const s of pendientes.filter(x => L.diaET(x.ts) === d)) {
      const j = a[s.jid]; if (!j || j.resuelto) continue;
      if (j.dep === 'tenis') { const r = await resolverTenis(j, senales); if (r) { calib = calib.concat(r); cambio = true; } continue; }
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
  if (!hist || hist.v !== 2 || AHORA - (estado.historiaTs || 0) > 20 * HORA) {
    try {
      let todos = [];
      for (const dep of ['nba', 'nhl', 'nfl', 'mlb']) {
        DIAG.pedidos++;
        const a = await L.pedir('https://raw.githubusercontent.com/osvaldoalvarez0113-source/ODDX/cierres/cierres-' + dep + '.json');
        if (a) todos = todos.concat(H.juegosDeCierres(dep, a));
      }
      if (todos.length) { hist = H.estudiar(todos); hist.v = 2; hist.generado = new Date(AHORA).toISOString(); estado.historiaTs = AHORA; }
    } catch (e) { err('historia', e); }
  }

  /* ---------- 8. lo que lee la página ---------- */
  const visibles = juegos.filter(j => j.ts > AHORA - 14 * HORA && j.ts - AHORA <= C.horas(j.dep) * HORA && Object.keys(j.m).length)
    .sort((a, b) => a.ts - b.ts).map(j => resumenJuego(j, senales));
  escribir('hoy.json', { generado: new Date(AHORA).toISOString(), juegos: visibles });
  escribir('senales.json', senales);
  escribir('senales-recientes.json', senales.filter(s => AHORA - s.t < 4 * DIA).sort((a, b) => b.t - a.t));
  escribir('calibracion.json', calib);
  escribir('medicion.json', tab);
  if (hist) escribir('historia.json', hist);

  /* ---------- 9. avisos ---------- */
  /* el robot corre cada 10 min: para no llenar el teléfono, los avisos se juntan y salen como mucho cada 25 min,
     salvo que haya un movimiento fuerte (2× o más) del ganador, hándicap o total, que sale enseguida */
  const avisables = nuevas.filter(s => s.mt !== 'prop' || s.nivel >= 2);
  estado.cola = (estado.cola || []).concat(primera ? [] : avisables.map(s => s.id));
  const porId = {}; senales.forEach(s => { porId[s.id] = s; });
  const cola = [...new Set(estado.cola)].map(id => porId[id]).filter(s => s && !s.res && s.ts > AHORA);   /* solo juegos que no han empezado */
  const urgente = cola.some(s => s.mt !== 'prop' && s.nivel >= 2);
  const toca = AHORA - (estado.ultimoAviso || 0) >= 25 * 60e3;
  let aviso = 'sin avisos';
  if (primera) { aviso = 'primera vuelta: no se avisa (todas las señales serían de golpe)'; estado.cola = []; }
  else if (!cola.length) estado.cola = [];
  else if (!process.env.NTFY_TOPIC) { aviso = 'falta el secreto NTFY_TOPIC'; estado.cola = []; }
  else if (toca || urgente) { aviso = await avisar(cola, tab); if (/^enviado/.test(aviso)) { estado.cola = []; estado.ultimoAviso = AHORA; } }
  else { aviso = 'en cola (' + cola.length + '), sale en la próxima tanda'; estado.cola = cola.map(s => s.id); }

  /* ---------- 10. estado ---------- */
  Object.keys(estado.vistas).forEach(k => { if (AHORA - estado.vistas[k] > 10 * DIA) delete estado.vistas[k]; });
  estado.corridas = (estado.corridas || 0) + 1;
  estado.ultima = new Date(AHORA).toISOString();
  const tenisVivos = juegos.filter(j => j.dep === 'tenis' && j.st === 'pre').length;
  estado.ultimaVuelta = { juegos: juegos.length, fotografiados: porFoto.length + tenisVivos, tenis: tenisVivos, senalesNuevas: nuevas.length, pedidos: DIAG.pedidos, errores: DIAG.errores.slice(0, 20), aviso };
  escribir('estado.json', estado);

  console.log('TIGRE ' + estado.ultima + ' · juegos ' + juegos.length + ' · fotografiados ' + porFoto.length + ' (+' + tenisVivos + ' de tenis) · mercados ' + porFoto.reduce((a, j) => a + Object.keys(j.m).length, 0) +
    ' · señales nuevas ' + nuevas.length + ' · señales en total ' + senales.length + ' (resueltas ' + senales.filter(s => s.res).length + ') · calibración ' + calib.length + ' · pedidos ' + DIAG.pedidos + ' · aviso: ' + aviso);
  nuevas.slice(0, 25).forEach(s => console.log('  ' + s.liga + ' ' + s.partido + ' · ' + s.tipo + ' · ' + s.txt + ' · ' + s.desc + ' · ' + s.mag + ' ' + s.unidad));
  if (DIAG.errores.length) { console.log('errores: ' + DIAG.errores.length); DIAG.errores.slice(0, 15).forEach(e => console.log('  ' + e)); }
}

/* tenis: pide el resultado a Kalshi; si ya está, cierra el partido, resuelve sus señales y devuelve las filas de calibración */
async function resolverTenis(j, senales) {
  let r;
  try { DIAG.pedidos++; r = await F.bajarResultadoTenis(j.id); } catch (e) { err('resultado tenis ' + j.id, e); return null; }
  if (!r || !r.fin) return null;
  R.fijarCierre(j);
  j.fin = true; j.st = 'post'; j.resuelto = AHORA;
  if (r.nulo) {                                   /* retiro o no se jugó: Kalshi paga a precio justo → las señales quedan nulas */
    j.cancel = true; j.det = 'Retiro / nulo';
    senales.forEach(s => { if (s.jid === j.id && !s.res) { s.res = 'nula'; s.g = 0; } });
    return [];
  }
  j.hs = r.ganador === 0 ? 1 : 0; j.as = r.ganador === 1 ? 1 : 0; j.det = 'Final · ganó ' + (r.ganador === 0 ? j.h.n : j.a.n);
  M.resolverSenales(senales, j, null);
  senales.forEach(s => { if (s.jid === j.id && s.res) s.marcador = 'Ganó ' + (r.ganador === 0 ? j.h.n : j.a.n); });
  return M.filasCalibracion(j, null);
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
  const sj = senales.filter(s => s.jid === j.id).map(s => ({ id: s.id, mk: s.mk, lado: s.lado, tipo: s.tipo, txt: s.txt, desc: s.desc, mag: s.mag, unidad: s.unidad, nivel: s.nivel, t: s.t, c: s.c, res: s.res || null, prop: s.mt === 'prop' || undefined }));
  return { id: j.id, dep: j.dep, liga: j.liga, ts: j.ts, st: j.st, det: j.det, h: j.h, a: j.a, hs: j.hs, as: j.as, m: mk, senales: sj };
}

/* un solo aviso por vuelta; si el mismo movimiento sale como ⚡ y 📈 a la vez, va en una sola línea con el récord de su tipo */
async function avisar(lista, tab) {
  const hora = ts => new Date(ts).toLocaleTimeString('es-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const ic = { rapido: '⚡', acumulado: '📈', kalshi: '🔀' };
  const grupos = {};
  lista.forEach(s => { const k = s.jid + '|' + s.mk + '|' + s.lado; (grupos[k] = grupos[k] || []).push(s); });
  const record = s => {
    const g = (tab.porTipoMercado || []).find(x => x.clave === s.tipo + '|' + s.mt);
    if (!g || g.n < 30) return '';
    const v = { probada: '✅ probada', pierde: '⛔ viene perdiendo', prueba: '🧪 en prueba' }[M.veredicto(g)];
    return '\n   récord: ' + g.gana + '% en ' + g.n + ' (prometía ' + g.promete + '%) · ROI ' + (g.roi > 0 ? '+' : '') + g.roi + '% · ' + v;
  };
  const items = Object.values(grupos).sort((a, b) => Math.max(...b.map(x => x.nivel)) - Math.max(...a.map(x => x.nivel)));
  const lineas = items.slice(0, 8).map(g => {
    const s = g.find(x => x.tipo !== 'acumulado') || g[0];
    return g.map(x => ic[x.tipo]).join('') + ' ' + s.liga + ' ' + s.partido + ' (' + hora(s.ts) + ')\n   ' + s.txt + ' · ' + s.desc + record(s);
  });
  if (items.length > 8) lineas.push('… y ' + (items.length - 8) + ' más en la página');
  try {
    const titulo = 'TIGRE: ' + items.length + (items.length === 1 ? ' movimiento nuevo' : ' movimientos nuevos');
    const u = 'https://ntfy.sh/' + encodeURIComponent(process.env.NTFY_TOPIC) + '?title=' + encodeURIComponent(titulo) + '&tags=tiger&click=' + encodeURIComponent(PAGINA);
    const r = await fetch(u, { method: 'POST', body: lineas.join('\n') });
    return r.ok ? 'enviado (' + items.length + ')' : 'ntfy HTTP ' + r.status;
  } catch (e) { return 'ntfy falló: ' + e.message; }
}

main().catch(e => { console.error('TIGRE: ERROR ' + (e && e.stack || e)); process.exit(1); });
