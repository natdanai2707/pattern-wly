// Headless harness: loads the Pattern.wly inline script in a vm sandbox with
// a DOM stub parsed from the real HTML (so id-wiring checks are meaningful).
'use strict';
const fs = require('fs');
const vm = require('vm');

function extractScript(html) {
  // app script is the last <script> block (first one is the three.js CDN tag)
  const m = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  const inline = m.filter(x => x[1].trim().length > 0);
  if (inline.length !== 1) throw new Error('expected exactly 1 inline script, got ' + inline.length);
  return inline[0][1];
}

function parseDom(html) {
  // strip script bodies so we only see real markup
  const markup = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g, '');
  const els = new Map();
  const re = /<(\w+)((?:[^>"]|"[^"]*")*?)\bid="([^"]+)"((?:[^>"]|"[^"]*")*?)>/g;
  let m;
  while ((m = re.exec(markup))) {
    const [, tag, pre, id, post] = m;
    const attrs = pre + ' ' + post;
    const get = n => { const a = attrs.match(new RegExp('\\b' + n + '="([^"]*)"')); return a ? a[1] : null; };
    const el = { tag: tag.toLowerCase(), id, type: get('type') || (tag === 'select' ? 'select-one' : tag === 'textarea' ? 'textarea' : ''), value: get('value') ?? '', checked: /\bchecked\b/.test(attrs), options: null };
    if (el.tag === 'select') {
      const rest = markup.slice(m.index);
      const body = rest.slice(0, rest.indexOf('</select>'));
      el.options = [...body.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(o => ({ value: o[1], selected: /\bselected\b/.test(o[2]) }));
      const sel = el.options.find(o => o.selected) || el.options[0];
      el.value = sel ? sel.value : '';
    }
    if (el.tag === 'input' && el.type === 'checkbox') el.value = 'on';
    els.set(id, el);
  }
  return els;
}

const ctx2d = new Proxy({}, { get: (t, k) => (k === 'canvas' ? {} : () => 0) });

function makeEl(spec) {
  const el = {
    tagName: (spec.tag || 'div').toUpperCase(),
    id: spec.id || '', type: spec.type || '', checked: !!spec.checked,
    style: {}, dataset: {}, disabled: false, textContent: '', files: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    insertBefore(c) { this.children.push(c); return c; },
    querySelectorAll() { return []; },
    getContext() { return ctx2d; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 220 }; },
    click() { this._clicked = (this._clicked || 0) + 1; if (this.onclick) this.onclick(); },
    select() {}, focus() {},
    clientWidth: 300, clientHeight: 220, width: 0, height: 0,
  };
  let v = spec.value ?? '';
  Object.defineProperty(el, 'value', { get: () => v, set: nv => { v = String(nv); }, configurable: true });
  return el;
}

class ThreeStubColor { constructor() { this.r = 0; this.g = 0; this.b = 0; } copy() { return this; } lerp() { return this; } }
const THREE = {
  Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
  WebGLRenderer: class { constructor() {} setSize() {} render() {} },
  Scene: class { constructor() { this.background = null; } add() {} remove() {} },
  Color: ThreeStubColor,
  PerspectiveCamera: class { constructor() { this.position = new THREE.Vector3(); this.up = new THREE.Vector3(); this.aspect = 1; } updateProjectionMatrix() {} lookAt() {} },
  GridHelper: class { constructor() { this.rotation = { x: 0 }; } },
  BufferGeometry: class { setAttribute() {} dispose() {} },
  Float32BufferAttribute: class { constructor() {} },
  LineSegments: class { constructor() { this.geometry = { dispose() {} }; } },
  LineBasicMaterial: class { constructor() {} },
};

function boot(htmlPath, { instrumentGrowth = false } = {}) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  let src = extractScript(html);
  if (instrumentGrowth)
    src = src.replace('for(let iter=0;iter<4000;iter++){', 'for(let iter=0;iter<4000;iter++){globalThis.__GROW_ITERS=iter+1;');

  const domSpecs = parseDom(html);
  const els = new Map();
  for (const [id, spec] of domSpecs) els.set(id, makeEl(spec));
  const missing = [];

  const timeouts = [];
  const downloads = [];
  const document = {
    getElementById(id) {
      if (!els.has(id)) { missing.push(id); els.set(id, makeEl({ id })); }
      return els.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return makeEl({}); },
    createElement(tag) { return makeEl({ tag }); },
    body: makeEl({ tag: 'body' }),
  };
  const sandbox = {
    console, document, THREE,
    window: { devicePixelRatio: 1, addEventListener() {} },
    location: { href: 'https://patternwly.test/', hash: '' },
    navigator: {},
    requestAnimationFrame() {},
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    clearTimeout() {},
    alert() {}, prompt() {},
    fetch: () => Promise.reject(new Error('offline')),
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = (opts || {}).type || ''; } },
    File: class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = (opts || {}).type || ''; } },
    FileReader: class { readAsText() {} },
    Date, performance: { now: () => Date.now() },
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: b => Buffer.from(b, 'base64').toString('binary'),
    escape: s => [...s].map(c => { const n = c.charCodeAt(0); return /[A-Za-z0-9@*_+\-./]/.test(c) ? c : n < 256 ? '%' + n.toString(16).toUpperCase().padStart(2, '0') : '%u' + n.toString(16).toUpperCase().padStart(4, '0'); }).join(''),
    unescape: s => s.replace(/%u([0-9a-fA-F]{4})|%([0-9a-fA-F]{2})/g, (_, u, x) => String.fromCharCode(parseInt(u || x, 16))),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const tail = `\n;globalThis.__X={buildTray,buildKnit,buildWeave,buildVase,toGcode,readParams,generate,SLIDER_RANGE,ALL_IDS,collectSettings,applySettings,annulusGrowth,profileAt,initFromHash,downloadFile,circlePath,
  getProf:()=>profPts, setProf:p=>{profPts=p}, setSides:s=>{vSides=s}, getSides:()=>vSides, lastG:()=>lastG};`;
  vm.runInContext(src + tail, sandbox, { filename: 'patternwly.js' });

  return {
    X: sandbox.globalThis.__X,
    els, missing, timeouts, downloads, sandbox, document,
    set(id, v) { const el = els.get(id); if (!el) throw new Error('no el ' + id); if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v); },
    get(id) { const el = els.get(id); return el.type === 'checkbox' ? el.checked : el.value; },
  };
}

module.exports = { boot, extractScript, parseDom };
