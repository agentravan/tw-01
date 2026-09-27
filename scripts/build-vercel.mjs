// Builds a Vercel deployment using the Build Output API v3 (https://vercel.com/docs/build-output-api/v3).
//   .vercel/output/static/        → dashboard/, console/, portal/ served from the CDN
//   .vercel/output/functions/api.func → the whole TW-01 server bundled into one Node function
// Only these folders become public. Source code, .env and data/ are never part of the output.
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = '.vercel/output';
await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'static'), { recursive: true });
for (const dir of ['dashboard', 'console', 'portal']) await cp(dir, join(OUT, 'static', dir), { recursive: true });
await writeFile(join(OUT, 'static', '404.html'), '<!doctype html><meta charset="utf-8"><title>Not found</title><p>Not found.</p>');

const fn = join(OUT, 'functions', 'api.func');
await mkdir(fn, { recursive: true });
await build({
  entryPoints: ['server/vercel.ts'], outfile: join(fn, 'index.mjs'), bundle: true, platform: 'node', target: 'node20', format: 'esm',
  // CommonJS dependencies (nodemailer) call require(); give the ESM bundle a real one.
  banner: { js: "import { createRequire as __tw01CreateRequire } from 'node:module'; const require = __tw01CreateRequire(import.meta.url);" },
  logLevel: 'warning',
});
await writeFile(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 60, regions: ['bom1'] }, null, 2));

const security = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', 'strict-transport-security': 'max-age=31536000' };
await writeFile(join(OUT, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '/(.*)', headers: security, continue: true },
    // One function serves the whole API; the original path travels as __p (read in server/app.ts).
    { src: '^/api/(.*)$', dest: '/api?__p=/api/$1' },
    { src: '^/$', dest: '/dashboard/index.html' },
    { src: '^/index\\.html$', dest: '/dashboard/index.html' },
    { src: '^/console/?$', dest: '/console/index.html' },
    { src: '^/portal/?$', dest: '/portal/index.html' },
    { handle: 'filesystem' },
    { src: '^/.*$', status: 404, dest: '/404.html' },
  ],
}, null, 2));
console.log('Vercel output written to', OUT);
