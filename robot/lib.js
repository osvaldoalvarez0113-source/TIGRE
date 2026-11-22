'use strict';
/* TIGRE · utilidades comunes (sin dependencias). */

/* cuota americana → número (acepta "+150", "-110", 150, "EVEN") */
function am(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') v = v.american !== undefined ? v.american : (v.value !== undefined ? v.value : v.alternateDisplayValue);
  if (typeof v === 'string' && /^even$/i.test(v.trim())) return 100;
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0 || (n > -100 && n < 100)) return null;
  return n;
}
/* probabilidad implícita (con margen) de una cuota americana */
function imp(a) { a = am(a); if (a === null) return null; return a > 0 ? 100 / (a + 100) : -a / (-a + 100); }
/* cuota decimal (lo que paga por 1 apostado, incluido lo apostado) */
function dec(a) { a = am(a); if (a === null) return null; return a > 0 ? 1 + a / 100 : 1 + 100 / -a; }
/* probabilidades sin margen de un grupo de cuotas (2 o 3 salidas) */
function sinMargen(cuotas) {
  const p = cuotas.map(imp);
  if (p.some(x => x === null)) return null;
  const s = p.reduce((a, b) => a + b, 0);
  if (!(s > 0.98 && s < 1.25)) return null;
  return p.map(x => x / s);
}
/* probabilidad → cuota americana (texto) */
function amTxt(p) {
  if (!(p > 0 && p < 1)) return '—';
  const a = p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p;
  return (a > 0 ? '+' : '') + Math.round(a);
}
function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') v = v.american !== undefined ? v.american : (v.value !== undefined ? v.value : v.alternateDisplayValue);
  const n = parseFloat(v); return isFinite(n) ? n : null;
}
/* ganancia de apostar 1 unidad a la cuota a: +ganancia si acierta, -1 si falla, 0 si push */
function ganancia(a, res) { if (res === 'push' || res === null || res === undefined) return 0; return res === 'gana' ? dec(a) - 1 : -1; }

const espera = ms => new Promise(r => setTimeout(r, ms));
async function pedir(url, intentos) {
  intentos = intentos || 3; let ult;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tigre/1.0 (github actions)' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { ult = e; await espera(800 * (i + 1)); }
  }
  throw ult;
}
/* corre tareas (funciones async) con un máximo de n a la vez */
async function pool(tareas, n) {
  const out = new Array(tareas.length); let i = 0;
  async function obrero() { while (i < tareas.length) { const k = i++; try { out[k] = await tareas[k](); } catch (e) { out[k] = null; } } }
  await Promise.all(Array.from({ length: Math.min(n || 6, tareas.length) }, obrero));
  return out;
}
/* fecha AAAA-MM-DD en hora del Este (así arman el día ESPN y Kalshi) */
function diaET(ts) { return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
function ymd(ts) { return diaET(ts).replace(/-/g, ''); }

module.exports = { am, imp, dec, sinMargen, amTxt, num, ganancia, pedir, pool, espera, diaET, ymd };
