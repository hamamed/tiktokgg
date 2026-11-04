import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Plain HTTP server that:
 *  - serves the built dashboard (dashboard/dist) with SPA fallback
 *  - serves the web demo client at /demo and the protocol schema at /schema
 *  - exposes GET /api/health and GET /api/state for scripts / OBS overlays
 * The WebSocket hub attaches to this same server on /ws.
 */
export function createHttpServer({ dashboardDist, extraStatic = {}, getState }) {
  const send = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const serveFile = (res, file) => {
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, { error: 'not found' });
      send(res, 200, buf, TYPES[path.extname(file)] ?? 'application/octet-stream');
    });
  };

  const safeJoin = (root, rel) => {
    const p = path.normalize(path.join(root, rel));
    return p.startsWith(root) ? p : null;
  };

  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });

    if (pathname === '/api/health') return send(res, 200, { ok: true, uptime: process.uptime() });
    if (pathname === '/api/state') return send(res, 200, getState());

    for (const [prefix, root] of Object.entries(extraStatic)) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
        const rel = pathname.slice(prefix.length) || '/index.html';
        const file = safeJoin(root, rel === '/' ? '/index.html' : rel);
        return file ? serveFile(res, file) : send(res, 403, { error: 'forbidden' });
      }
    }

    if (!fs.existsSync(dashboardDist)) {
      return send(
        res,
        200,
        '<h1>TikTok Game server is running</h1><p>Dashboard not built. Run <code>npm run build</code> in the project root, ' +
          'or use the Vite dev server: <code>npm run dashboard</code> → http://localhost:5173</p><p>Web demo game: <a href="/demo">/demo</a></p>',
        'text/html; charset=utf-8',
      );
    }
    const file = safeJoin(dashboardDist, pathname === '/' ? '/index.html' : pathname);
    if (!file) return send(res, 403, { error: 'forbidden' });
    fs.stat(file, (err, st) => serveFile(res, !err && st.isFile() ? file : path.join(dashboardDist, 'index.html')));
  });
}
