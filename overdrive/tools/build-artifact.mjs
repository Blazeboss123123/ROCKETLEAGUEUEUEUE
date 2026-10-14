#!/usr/bin/env node
// Bundles the browser client into ONE self-contained HTML page (dist/overdrive.html):
// inlined CSS + every ES module wrapped in a function scope, with three.js imported from cdnjs.
// Usage: node tools/build-artifact.mjs [--local-three]   (--local-three inlines vendor/three for offline use)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.160.0/three.module.min.js';
const localThree = process.argv.includes('--local-three');

const mods = new Map(); // abs path -> {code, deps, exports}
const order = [];

function load(abs, stack = []) {
  if (mods.has(abs)) return;
  if (stack.includes(abs)) throw new Error('import cycle: ' + [...stack, abs].map((p) => path.relative(ROOT, p)).join(' -> '));
  const src = readFileSync(abs, 'utf8');
  const deps = [];
  const exports = [];
  const lines = src.split('\n').map((line) => {
    let m = line.match(/^import \* as (\w+) from '([^']+)';\s*$/);
    if (m) { const dep = resolve(abs, m[2]); deps.push(dep); return `const ${m[1]} = __m[${JSON.stringify(key(dep))}];`; }
    m = line.match(/^import \{([^}]+)\} from '([^']+)';\s*$/);
    if (m) {
      const dep = resolve(abs, m[2]); deps.push(dep);
      const names = m[1].split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
      return `const { ${names.join(', ')} } = __m[${JSON.stringify(key(dep))}];`;
    }
    if (/^import /.test(line)) throw new Error(`unsupported import in ${path.relative(ROOT, abs)}: ${line}`);
    m = line.match(/^export (async function|function|class|const|let) (\w+)/);
    if (m) { exports.push(m[2]); return line.replace(/^export /, ''); }
    m = line.match(/^export \{([^}]+)\};?\s*$/);
    if (m) { m[1].split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exports.push(n)); return ''; }
    if (/^export /.test(line)) throw new Error(`unsupported export in ${path.relative(ROOT, abs)}: ${line}`);
    return line;
  });
  mods.set(abs, { code: lines.join('\n'), deps, exports });
  for (const d of deps) if (d !== 'three') load(d, [...stack, abs]);
  order.push(abs);
}
function resolve(from, spec) { return spec === 'three' ? 'three' : path.resolve(path.dirname(from), spec); }
function key(abs) { return abs === 'three' ? 'three' : path.relative(ROOT, abs); }

load(path.join(ROOT, 'client/main.js'));

let js = `"use strict";\nconst __m = Object.create(null);\n__m["three"] = __THREE;\n`;
for (const abs of order) {
  const m = mods.get(abs);
  js += `\n// ---- ${key(abs)}\n__m[${JSON.stringify(key(abs))}] = (() => {\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();\n`;
}

let threeHeader;
if (localThree) {
  // inline three.js as its own module via a blob URL import
  const t = readFileSync(path.join(ROOT, 'vendor/three.module.min.js'), 'utf8');
  threeHeader = `<script>window.__THREE_SRC = ${JSON.stringify(t)};</script>`;
  js = `const __THREE = await import(URL.createObjectURL(new Blob([window.__THREE_SRC], { type: 'text/javascript' })));\n` + js;
} else {
  threeHeader = '';
  js = `import * as __THREE from '${THREE_URL}';\n` + js;
}

const css = readFileSync(path.join(ROOT, 'client/styles.css'), 'utf8');
const html = `${localThree ? '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n' : ''}<title>Project Overdrive</title>
<meta name="description" content="Rocket-car football: offline bot matches, training drills, and browser-hosted multiplayer.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,500;0,600;0,700;1,700&family=Inter:wght@400;500;600&display=swap">
<style>
/* Single deliberate dark look: a night stadium with an electric-cyan accent, blue and orange team colours. */
:root { color-scheme: dark; }
html, body { height: 100%; }
${css}
</style>
<div id="app"><div class="ui-layer"></div></div>
<noscript>Project Overdrive needs JavaScript and WebGL.</noscript>
${threeHeader}
<script type="module">
${js}
</script>
`;
mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, localThree ? 'dist/overdrive-offline.html' : 'dist/overdrive.html');
writeFileSync(out, html);
console.log(`wrote ${path.relative(ROOT, out)} (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules)`);
