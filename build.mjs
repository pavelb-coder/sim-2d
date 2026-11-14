import { build } from 'esbuild';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';

/**
 * Сборка в один самодостаточный index.html:
 * CSS, JS и шрифт (base64 TTF) инлайнятся, чтобы редактор работал офлайн
 * и в песочнице предпросмотра — без внешних CDN и запросов.
 */
const bundle = await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  minify: true,
  legalComments: 'none',
  loader: { '.ttf': 'base64' },
});

const js = bundle.outputFiles[0].text;
const css = await readFile('src/styles.css', 'utf8');
let html = await readFile('src/index.html', 'utf8');

let fontTag = '';
try {
  const font = await readFile('assets/fonts/DejaVuSans-subset.ttf');
  fontTag = `<script>window.__LASERCUT_FONT__="${font.toString('base64')}";</script>\n`;
} catch {
  console.warn('шрифт не найден — инструмент «Текст» будет недоступен');
}

html = html.replace('<link rel="stylesheet" href="./styles.css">', `<style>\n${css}\n</style>`);
html = html.replace('<script type="module" src="./main.ts"></script>', `${fontTag}<script>\n${js}\n</script>`);

await mkdir('site', { recursive: true });
await mkdir('docs', { recursive: true });
await writeFile('site/index.html', html);
// docs/index.html — та же сборка для GitHub Pages (source: branch main, /docs)
await writeFile('docs/index.html', html);

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`built index.html — ${kb(html.length)}  (js ${kb(js.length)}, css ${kb(css.length)}, font ${kb(fontTag.length)})`);

const info = await stat('site/index.html');
console.log(`site/index.html: ${(info.size / 1024).toFixed(1)} KB on disk`);
