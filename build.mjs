import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

/**
 * Сборка в один самодостаточный site/index.html:
 * CSS и JS инлайнятся, чтобы прототип работал и в песочнице предпросмотра, и офлайн.
 */
const bundle = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  minify: true,
  legalComments: 'none',
});

const js = bundle.outputFiles[0].text;
const css = await readFile('src/styles.css', 'utf8');
let html = await readFile('src/index.html', 'utf8');

html = html.replace('<link rel="stylesheet" href="./styles.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="./main.ts"></script>', `<script>\n${js}\n</script>`);

await mkdir('site', { recursive: true });
await mkdir('docs', { recursive: true });
await writeFile('site/index.html', html);
// docs/index.html — та же сборка для GitHub Pages (source: branch main, /docs)
await writeFile('docs/index.html', html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`built site/index.html — ${kb(html.length)}  (js ${kb(js.length)}, css ${kb(css.length)})`);
