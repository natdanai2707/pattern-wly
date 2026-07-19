'use strict';
const { boot } = require('./harness');
const HTML = process.argv[2] || require('path').join(__dirname, '..', 'index.html');
const findings = [];
let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; } else { fail++; findings.push('FAIL: ' + label); console.log('  ✗ ' + label); } }
function note(label) { findings.push('NOTE: ' + label); console.log('  • ' + label); }

const MODE_OF = id => {
  if (/^wv/.test(id)) return 'weave';
  if (/^(v[A-Z]|p[A-Z]|st[A-Z]|f[A-Z])/.test(id)) return 'vase';
  if (['dia','baseLayers','holeD','gapS','strandW','seed','cell','wlen','wN','wAmp','hCell','wallLayers','finN','finDepth','twist','flare'].includes(id)) return 'tray';
  if (['ringD','kN','kZ','kR','kLayers'].includes(id)) return 'knit';
  return 'weave'; // printer params: exercise in default mode
};

function pathsOf(app, mode) {
  app.set('mode', mode);
  const P = app.X.readParams();
  const paths = mode==='knit'?app.X.buildKnit(P):mode==='vase'?app.X.buildVase(P):mode==='weave'?app.X.buildWeave(P):app.X.buildTray(P);
  return { P, paths };
}

function checkPaths(paths, P, label, { bedWarnOnly = true } = {}) {
  let bad = null, minZ = Infinity, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, nPts = 0;
  for (const p of paths) {
    if (!p.pts || !p.pts.length) continue;
    if (!isFinite(p.v) || p.v <= 0) bad = bad || `speed v=${p.v}`;
    if (!isFinite(p.w) || p.w < 0) bad = bad || `width w=${p.w}`;
    for (const q of p.pts) {
      nPts++;
      if (!isFinite(q[0]) || !isFinite(q[1]) || !isFinite(q[2])) { bad = bad || `non-finite pt ${q}`; break; }
      if (q[2] < minZ) minZ = q[2];
      if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
      if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
    }
  }
  ok(!bad, `${label}: coords finite/valid (${bad || ''})`);
  ok(minZ >= P.flh - 1e-6, `${label}: minZ ${minZ.toFixed(3)} >= flh ${P.flh}`);
  const inBed = minX >= 0 && minY >= 0 && maxX <= 256 && maxY <= 256;
  if (!inBed) {
    if (bedWarnOnly) note(`${label}: outside bed X[${minX.toFixed(1)},${maxX.toFixed(1)}] Y[${minY.toFixed(1)},${maxY.toFixed(1)}]`);
    else ok(false, `${label}: bed bounds`);
  }
  return { minZ, minX, maxX, minY, maxY, nPts };
}

function gcodeScan(text, label) {
  ok(!/\bNaN\b/.test(text) && !/Infinity/.test(text), `${label}: gcode has no NaN/Infinity`);
  ok(!text.includes('{NOZ}') && !text.includes('{BED}'), `${label}: temps injected`);
  ok(!/\{[A-Z]/.test(text), `${label}: no unresolved {PLACEHOLDER} tokens`);
}

/* ============== task 1: default + slider extremes, every mode ============== */
console.log('== T1: defaults + slider extremes ==');
{
  const app = boot(HTML);
  for (const mode of ['weave', 'vase', 'tray', 'knit']) {
    const { P, paths } = pathsOf(app, mode);
    checkPaths(paths, P, `default/${mode}`, { bedWarnOnly: false });
    gcodeScan(app.X.toGcode(paths, P).text, `default/${mode}`);
  }
}
{
  const t0 = Date.now();
  const app = boot(HTML);
  const SR = app.X.SLIDER_RANGE;
  for (const [id, [mn, mx]] of Object.entries(SR)) {
    const mode = MODE_OF(id);
    for (const v of [mn, mx]) {
      const fresh = boot(HTML);          // isolate: other params at defaults
      fresh.set(id, v);
      if (id === 'wvGap' || id === 'wvSeed') fresh.set('wvBase', 'growth');
      if (/^(gapS|strandW|seed|holeD)$/.test(id)) fresh.set('pattern', 'growth');
      if (id === 'cell' || id === 'wlen') fresh.set('pattern', 'meander');
      if (/^(wN|wAmp)$/.test(id)) fresh.set('pattern', 'waves');
      if (id === 'hCell') fresh.set('pattern', 'hilbert');
      if (/^st/.test(id)) fresh.set('stOn', true);
      if (/^fInner|fRing|fSpoke/.test(id)) fresh.set('fFill', 'lamp');
      let r;
      try { r = pathsOf(fresh, mode); } catch (e) { ok(false, `extreme ${id}=${v} (${mode}): threw ${e.message}`); continue; }
      checkPaths(r.paths, r.P, `extreme ${id}=${v} (${mode})`);
      const g2 = fresh.X.toGcode(r.paths, r.P);
      ok(!/\bNaN\b/.test(g2.text) && !/Infinity/.test(g2.text), `extreme ${id}=${v}: gcode finite`);
    }
  }
  console.log(`  (extremes sweep ${(Date.now() - t0) / 1000}s)`);
}

/* ============== task 2: extrusion volume ============== */
console.log('== T2: extrusion volume ==');
{
  const app = boot(HTML);
  app.set('flow', 1); app.set('lw', 0.45); app.set('lh', 0.2);
  const P = app.X.readParams();
  const path = { pts: [[50, 50, 5], [150, 50, 5]], v: 30, w: 0.45 }; // 100mm, uses lh via p.h||P.lh
  const g = app.X.toGcode([path], P);
  const es = [...g.text.matchAll(/^G1 X[\d.]+ Y[\d.]+ Z[\d.]+ E([\d.]+)/gm)].map(m => parseFloat(m[1]));
  const tot = es.reduce((a, b) => a + b, 0);
  const want = 100 * 0.45 * 0.2 / 2.405;
  ok(Math.abs(tot - want) / want < 0.001, `100mm line E=${tot.toFixed(5)} vs ${want.toFixed(5)} (${(100 * Math.abs(tot - want) / want).toFixed(3)}%)`);
  // first-layer h honored by toGcode
  const pf = { pts: [[50, 50, P.flh], [150, 50, P.flh]], v: 30, w: P.flw, h: P.flh };
  const gf = app.X.toGcode([pf], P);
  const ef = [...gf.text.matchAll(/^G1 X[\d.]+ Y[\d.]+ Z[\d.]+ E([\d.]+)/gm)].reduce((a, m) => a + parseFloat(m[1]), 0);
  const wantF = 100 * P.flw * P.flh / 2.405;
  ok(Math.abs(ef - wantF) / wantF < 0.001, `first-layer path uses h=flh in E (${ef.toFixed(5)} vs ${wantF.toFixed(5)})`);
  // every mode: do the paths at z==flh carry h=flh?
  for (const mode of ['weave', 'vase', 'tray', 'knit']) {
    const { P: Pm, paths } = pathsOf(app, mode);
    const first = paths.filter(p => p.pts.length && p.pts.every(q => Math.abs(q[2] - Pm.flh) < 1e-9));
    const allFlh = first.length > 0 && first.every(p => (p.h || Pm.lh) === Pm.flh);
    ok(allFlh, `${mode}: first-layer paths use flh in E math (found ${first.length} first-layer paths)`);
  }
}

/* ============== task 3: weave base-to-wall bonding ============== */
console.log('== T3: weave bonding ==');
{
  const configs = [];
  for (const sides of [0, 3, 4, 6, 9, 12]) for (const rim of [0, 1, 3, 5]) configs.push({ sides, rim, tw: 0, base: 'weave' });
  configs.push({ sides: 0, rim: 1, tw: 6, base: 'weave' });
  configs.push({ sides: 5, rim: 2, tw: -6, base: 'weave' });
  configs.push({ sides: 0, rim: 1, tw: 0, base: 'growth' });
  configs.push({ sides: 6, rim: 0, tw: 0, base: 'growth' });
  configs.push({ sides: 0, rim: 1, tw: 0, base: 'weave', tri: 40, egg: 40, len: 40 }); // extreme pebble
  for (const c of configs) {
    const app = boot(HTML);
    app.set('wvWallLayers', 1);  // bonding = wall layer 0 vs base top; upper layers sit on wall below
    app.set('wvSides', c.sides); app.set('wvRim', c.rim); app.set('wvTwistW', c.tw); app.set('wvBase', c.base);
    if (c.tri !== undefined) { app.set('wvTri', c.tri); app.set('wvEgg', c.egg); app.set('wvLen', c.len); }
    const { P, paths } = pathsOf(app, 'weave');
    const zf = i => P.flh + i * P.lh;
    const nSolid = Math.max(0, Math.round(P.wvSolid));
    const zTopBase = zf(nSolid + P.wvLayers - 1);
    const ramp0 = nSolid + P.wvLayers;
    const zWall0 = zf(ramp0);
    const NB = 48, baseMax = new Array(NB).fill(-1), wallPts = [];
    const cx = P.cx;
    for (const p of paths) for (const q of p.pts) {
      const z = q[2];
      const a = Math.atan2(q[1] - cx, q[0] - cx), bin = ((Math.floor(a / (2 * Math.PI) * NB) % NB) + NB) % NB;
      const r = Math.hypot(q[0] - cx, q[1] - cx);
      if (Math.abs(z - zTopBase) < 1e-9 && r < P.wvLen) { if (r > baseMax[bin]) baseMax[bin] = r; } // exclude skirt via r<wvLen... skirt at Rmax+5 could still be < wvLen; better: skip first 2 paths
      if (z >= zWall0 - 1e-9 && z <= zWall0 + 0.5) wallPts.push([bin, r]);
    }
    // redo baseMax excluding the 2 skirt paths
    baseMax.fill(-1);
    paths.slice(2).forEach(p => { for (const q of p.pts) { if (Math.abs(q[2] - zTopBase) < 1e-9) { const a = Math.atan2(q[1] - cx, q[0] - cx), bin = ((Math.floor(a / (2 * Math.PI) * NB) % NB) + NB) % NB; const r = Math.hypot(q[0] - cx, q[1] - cx); if (r > baseMax[bin]) baseMax[bin] = r; } } });
    let worst = -Infinity, worstBin = -1;
    const wallMaxPerBin = new Array(NB).fill(-1);
    for (const [b, r] of wallPts) if (r > wallMaxPerBin[b]) wallMaxPerBin[b] = r;
    for (let b = 0; b < NB; b++) {
      if (wallMaxPerBin[b] < 0 || baseMax[b] < 0) continue;
      const gap = wallMaxPerBin[b] - baseMax[b]; // wall outside base support by this much
      if (gap > worst) { worst = gap; worstBin = b; }
    }
    const w = P.wvStrand;
    ok(worst <= w * 1.0 + 1e-6, `bond sides=${c.sides} rim=${c.rim} tw=${c.tw} ${c.base}${c.tri ? ' extreme-pebble' : ''}: wall≤base+w (worst gap ${worst.toFixed(2)}mm @bin${worstBin}, w=${w})`);
  }
}

/* ============== task 4: speed caps ============== */
console.log('== T4: speed caps ==');
{
  // knit: coil layers ≤22 even with v1/vWall maxed
  let app = boot(HTML);
  app.set('v1', 60); app.set('vWall', 120);
  let { P, paths } = pathsOf(app, 'knit');
  // only print moves (XYZ+E) — travel unretracts (G1 E0.8 F1800) are exempt from print-speed caps
  const maxExtF = (a, pp, PP) => Math.max(...[...a.X.toGcode(pp, PP).text.matchAll(/^G1 X[\d.]+ Y[\d.]+ Z[\d.]+ E[\d.]+ F(\d+)$/gm)].map(m => +m[1]));
  const coils = paths.slice(P.brim ? 7 : 0);   // construction order: 7 brim circles first
  ok(coils.every(p => p.v <= 22 + 1e-9), `knit coils ≤22 incl first layer (max ${Math.max(...coils.map(p => p.v))})`);
  ok(maxExtF(app, coils, P) <= 22 * 60, `knit coil gcode F ≤1320`);
  // weave: coil wall ≤22, fat strands ≤25 (enforced at gcode emission)
  app = boot(HTML);
  app.set('v1', 60); app.set('vWall', 120); app.set('vBase', 120); app.set('wvStrand', 0.8);
  ({ P, paths } = pathsOf(app, 'weave'));
  const wall = paths.filter(p => p.w === P.wvStrand && p.pts[0][2] > P.flh + (P.wvLayers - 1) * P.lh + 1e-6);
  const strands = paths.filter(p => p.w === P.wvStrand && p.pts[0][2] <= P.flh + (P.wvLayers - 1) * P.lh + 1e-6);
  ok(wall.every(p => p.v <= 22 + 1e-9), `weave wall coil ≤22 (max ${Math.max(...wall.map(p => p.v))})`);
  ok(strands.length > 0 && maxExtF(app, strands, P) <= 25 * 60, `weave fat strands (w=0.8) gcode F ≤1500 incl first layer`);
  // tray growth fat strands
  app = boot(HTML);
  app.set('v1', 60); app.set('vBase', 120); app.set('pattern', 'growth'); app.set('strandW', 0.8);
  ({ P, paths } = pathsOf(app, 'tray'));
  const gs = paths.filter(p => p.w === P.strandW);
  ok(gs.every(p => p.v <= 25 + 1e-9) && maxExtF(app, gs, P) <= 1500, `tray growth strands ≤25 (max ${Math.max(...gs.map(p => p.v))})`);
  // generic fat-strand cap at emission
  {
    const F = maxExtF(app, [{ pts: [[50, 50, 1], [150, 50, 1]], v: 45, w: 0.65 }], P);
    ok(F <= 1500, `toGcode caps w=0.65 v=45 path to F${F} ≤1500`);
  }
  // vase stitched walls ≤25
  app = boot(HTML);
  app.set('vWall', 120); app.set('stOn', true);
  ({ P, paths } = pathsOf(app, 'vase'));
  const wallsV = paths.filter(p => p.wpts || (p.pts[0][2] > P.flh + (P.fLayers - 1) * P.lh + 1e-6 && p.pts.length > 200));
  const vCapVol = Math.min(P.vWall, 12 / (P.lw * P.lh)); // OGcode parity: volumetric ceiling, not flat 25
  ok(wallsV.length > 0 && wallsV.every(p => p.v <= vCapVol + 1e-9), `vase stitched walls ≤min(vWall, 12mm3/s) (max ${Math.max(...wallsV.map(p => p.v))} cap ${vCapVol.toFixed(1)})`);
  // non-spiral stitched too
  app = boot(HTML);
  app.set('vWall', 120); app.set('stOn', true); app.set('vSpiral', false);
  ({ P, paths } = pathsOf(app, 'vase'));
  const wallsNS = paths.filter(p => p.pts[0][2] > P.flh + (P.fLayers - 1) * P.lh + 1e-6 && p.pts.length > 200);
  const vCapNS = Math.min(P.vWall, 12 / (P.lw * P.lh));
  ok(wallsNS.every(p => p.v <= vCapNS + 1e-9), `vase stitched non-spiral walls ≤min(vWall, 12mm3/s) (max ${Math.max(...wallsNS.map(p => p.v))})`);
}

/* ============== task 5: gcode structure ============== */
console.log('== T5: gcode structure ==');
{
  const app = boot(HTML);
  const { P, paths } = pathsOf(app, 'weave');
  const g = app.X.toGcode(paths, P);
  const t = g.text;
  ok((t.match(/EXECUTABLE_BLOCK_START/g) || []).length === 1, 'exactly one start block');
  ok((t.match(/EXECUTABLE_BLOCK_END/g) || []).length === 1, 'exactly one end block');
  gcodeScan(t, 'structure');
  const lines = t.split('\n');
  const iM83 = lines.lastIndexOf('M83');
  const iFirstPrint = lines.findIndex((l, i) => i > 0 && /^G1 X[\d.]+ Y[\d.]+ Z[\d.]+ E/.test(l));
  ok(iM83 >= 0 && iM83 < iFirstPrint, `M83 (@${iM83}) before first print move (@${iFirstPrint})`);
  const fanS = Math.round(255 * P.fanPct / 100);
  const iFan = lines.findIndex((l, i) => i > iM83 && l.startsWith('M106 P1 S' + fanS));
  ok(iFan > 0, `fan M106 P1 S${fanS} present after start`);
  if (iFan > 0) {
    // fan is emitted just before the triggering layer's ;Z comment → search forward
    let zAt = null;
    for (let i = iFan; i < lines.length; i++) { const m = lines[i].match(/^;Z ([\d.]+)/); if (m) { zAt = parseFloat(m[1]); break; } }
    const layerAt = zAt === null ? null : Math.round((zAt - P.flh) / P.lh) + 1;
    ok(layerAt === P.fanL, `fan fires at layer ${layerAt} (configured ${P.fanL}, z=${zAt})`);
  }
  // travel = retract + z-hop
  const iRet = lines.findIndex(l => l === 'G1 E-0.8 F1800');
  ok(iRet > 0 && /^G0 Z/.test(lines[iRet + 1]) && /^G0 X/.test(lines[iRet + 2]) && /^G0 Z/.test(lines[iRet + 3]) && lines[iRet + 4] === 'G1 E0.8 F1800',
    'travel does retract + z-hop + move + z-down + unretract');
  ok(t.endsWith('\n'), 'file ends with newline');
  // fan edge: flh<lh case
  const app2 = boot(HTML);
  app2.set('flh', 0.1); app2.set('lh', 0.4); app2.set('fanL', 2);
  const r2 = pathsOf(app2, 'vase');
  const t2 = app2.X.toGcode(r2.paths, r2.P).text;
  const l2 = t2.split('\n');
  const iFan2 = l2.findIndex((l, i) => i > l2.lastIndexOf('M83') && l.startsWith('M106 P1 S255'));
  let zAt2 = null; for (let i = iFan2; i < l2.length; i++) { const m = l2[i].match(/^;Z ([\d.]+)/); if (m) { zAt2 = parseFloat(m[1]); break; } }
  const layer2 = Math.round((zAt2 - 0.1) / 0.4) + 1;
  ok(layer2 === 2, `fan with flh=0.1 lh=0.4 fires at layer ${layer2} (want 2)`);
  // end gcode absolute Z sanity: any absolute G1 Z in the end block must be >= zTop
  let zTop = 0; for (const p of paths) for (const q of p.pts) if (q[2] > zTop) zTop = q[2];
  const endIdx = t.indexOf('; filament end gcode');
  const endTxt = endIdx >= 0 ? t.slice(endIdx) : t.slice(t.lastIndexOf('M140 S0'));
  const zMoves = [...endTxt.matchAll(/^G1 Z([\d.]+)/gm)].map(m => parseFloat(m[1]));
  ok(zMoves.every(z => z >= zTop - 1e-6), `end-gcode absolute Z moves all >= print top ${zTop.toFixed(2)} (got ${zMoves.join(',')})`);
}

/* ============== task 6: UI wiring / roundtrip ============== */
console.log('== T6: UI wiring ==');
{
  const app = boot(HTML);
  const domIds = new Set(app.els.keys());
  const bad1 = app.X.ALL_IDS.filter(id => !domIds.has(id));
  ok(bad1.length === 0, `ALL_IDS all exist in DOM (missing: ${bad1.join(',')})`);
  ok(app.missing.length === 0, `no $() lookups of nonexistent ids during boot (${[...new Set(app.missing)].join(',')})`);
  // reverse: settings-relevant DOM controls covered by ALL_IDS
  const skip = new Set(['loadFile', 'odName', 'odContact', 'odNote', 'showT']);
  const ctrls = [...app.els.values()].filter(e => ['input', 'select', 'textarea'].includes(e.tagName.toLowerCase()) && !skip.has(e.id));
  const bad2 = ctrls.filter(e => !app.X.ALL_IDS.includes(e.id)).map(e => e.id);
  ok(bad2.length === 0, `all DOM controls in ALL_IDS (uncovered: ${bad2.join(',')})`);
  // roundtrip
  app.set('wvLen', 137); app.set('stOn', true); app.X.setSides(8);
  app.X.setProf([{ t: 0, f: 0.5 }, { t: 0.4, f: 1.1 }, { t: 1, f: 0.7 }]);
  const s1 = app.X.collectSettings();
  const app2 = boot(HTML);
  app2.X.applySettings(JSON.parse(JSON.stringify(s1)));
  const s2 = app2.X.collectSettings();
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'Export→Import JSON round-trips identically (incl profile+sides)');
  // customer link hash
  const b64 = app.sandbox.btoa(app.sandbox.unescape(encodeURIComponent(JSON.stringify(s1))));
  const app3 = boot(HTML);
  app3.sandbox.location.hash = '#s=' + b64 + '&share=1';
  app3.X.initFromHash();
  const s3 = app3.X.collectSettings();
  ok(JSON.stringify(s1) === JSON.stringify(s3), 'customer link hash decodes to same settings');
}

/* ============== task 7: mobile paths (static + behavior) ============== */
console.log('== T7: mobile download/copy/share ==');
{
  const app = boot(HTML);
  app.X.downloadFile('hello', 'x.gcode');
  const body = app.document.body;
  ok(body.children.length >= 1 && body.children[0].tagName === 'A', 'downloadFile appends anchor to DOM');
  const revoke = app.timeouts.find(x => x.ms >= 1000);
  ok(!!revoke, `revokeObjectURL delayed (${revoke && revoke.ms}ms)`);
  const src = require('fs').readFileSync(HTML, 'utf8');
  ok(/mime\|\|'application\/octet-stream'/.test(src), 'download defaults to octet-stream');
  ok(/execCommand\('copy'\)/.test(src), 'copy has execCommand fallback');
  ok(/navigator\.canShare&&navigator\.canShare\(\{files:/.test(src) && /else\{[^}]*downloadFile/s.test(src.slice(src.indexOf("$('sh').onclick"))), 'share falls back to download without canShare');
}

/* ============== task 8: performance / growth termination ============== */
console.log('== T8: performance ==');
{
  const app = boot(HTML, { instrumentGrowth: true });
  const t0 = Date.now();
  app.set('mode', 'weave');
  app.X.generate();
  const dt = Date.now() - t0;
  ok(dt < 1500, `default weave generate ${dt}ms < 1500ms`);
  for (const gap of [1.5, 3.4, 8]) for (const dia of [40, 110, 220]) {
    const t1 = Date.now();
    app.sandbox.globalThis.__GROW_ITERS = 0;
    const pts = app.X.annulusGrowth(0, dia / 2, gap, 42);
    const it = app.sandbox.globalThis.__GROW_ITERS;
    ok(it < 4000 && pts.length > 10, `growth gap=${gap} dia=${dia}: ${it} iters, ${pts.length} pts, ${Date.now() - t1}ms`);
  }
}

/* ============== task 9: specific bug classes ============== */
console.log('== T9: bug classes ==');
{
  // blank inputs
  for (const id of ['lh', 'flh', 'lw', 'flw', 'vLenX', 'vWidY', 'vH', 'stSpace', 'v1', 'vWall', 'vBase', 'vT', 'flow', 'wvStrand']) {
    const app = boot(HTML);
    app.set(id, '');
    app.set('stOn', true);
    let threw = null, r = null;
    try { r = pathsOf(app, MODE_OF(id) === 'weave' && /^(lh|flh|lw|flw|v1|vWall|vBase|vT|flow)$/.test(id) ? 'vase' : MODE_OF(id)); } catch (e) { threw = e.message; }
    ok(!threw, `blank ${id}: no throw (${threw})`);
    if (r) {
      let badPt = false;
      for (const p of r.paths) for (const q of p.pts) if (!isFinite(q[0]) || !isFinite(q[1]) || !isFinite(q[2])) badPt = true;
      ok(!badPt, `blank ${id}: coords finite`);
      const g = app.X.toGcode(r.paths, r.P);
      ok(!/\bNaN\b/.test(g.text) && !/F0\b/.test(g.text) && !/Infinity/.test(g.text), `blank ${id}: gcode has no NaN/F0/Infinity`);
    }
  }
  // duplicate profile t
  {
    const app = boot(HTML);
    app.X.setProf([{ t: 0, f: 0.9 }, { t: 0.5, f: 0.4 }, { t: 0.5, f: 1.1 }, { t: 1, f: 0.9 }]);
    let threw = null; let r;
    try { r = pathsOf(app, 'vase'); } catch (e) { threw = e.message; }
    ok(!threw, `duplicate profile t: no throw (${threw})`);
    if (r) checkPaths(r.paths, r.P, 'duplicate profile t');
  }
  // spiralize + 0 floor layers
  for (const cfg of [['none', 4], ['rings', 0]]) {
    const app = boot(HTML);
    app.set('fFill', cfg[0]); app.set('fLayers', cfg[1]); app.set('vSpiral', true);
    const r = pathsOf(app, 'vase');
    checkPaths(r.paths, r.P, `spiralize fFill=${cfg[0]} fLayers=${cfg[1]}`);
  }
  // wallLayers=1 equivalent (vase H == lh)
  {
    const app = boot(HTML);
    app.set('vH', 0.2);
    const r = pathsOf(app, 'vase');
    checkPaths(r.paths, r.P, 'vase single wall layer');
  }
  // malformed base64 hash
  {
    const app = boot(HTML);
    app.sandbox.location.hash = '#s=!!!notbase64%%%&share=1';
    let threw = null;
    try { app.X.initFromHash(); } catch (e) { threw = e.message; }
    ok(!threw, `malformed hash: no throw (${threw})`);
  }
  // vase XY asymmetry: floor must reach wall (sy bug)
  {
    const app = boot(HTML);
    app.set('vLenX', 70); app.set('vWidY', 140);
    const { P, paths } = pathsOf(app, 'vase');
    // wall layer-1 pts vs floor top layer pts along Y axis
    const zFloorTop = P.flh + (P.fLayers - 1) * P.lh, zWall1 = zFloorTop + P.lh;
    let floorMaxY = -1, wallMaxYatZ1 = -1;
    for (const p of paths) for (const q of p.pts) {
      if (Math.abs(q[2] - zFloorTop) < 1e-9 && Math.abs(q[0] - P.cx) < 3) floorMaxY = Math.max(floorMaxY, Math.abs(q[1] - P.cx));
      if (Math.abs(q[2] - zWall1) < 1e-6 && Math.abs(q[0] - P.cx) < 3) wallMaxYatZ1 = Math.max(wallMaxYatZ1, Math.abs(q[1] - P.cx));
    }
    ok(wallMaxYatZ1 - floorMaxY <= P.lw, `vase Y=2X: wall Y-extent ${wallMaxYatZ1.toFixed(1)} within lw of floor ${floorMaxY.toFixed(1)} (skirt excluded)`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
