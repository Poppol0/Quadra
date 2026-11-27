import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)),'../dist/online');
const port = Number(process.env.QUADRA_PORT || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta Quadra non valida');
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png' };
http.createServer(async (request,response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url,'http://localhost').pathname);
    const path = resolve(root,'.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(path);
    response.writeHead(200,{'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-store',
      'Cross-Origin-Opener-Policy':'same-origin-allow-popups'});
    response.end(body);
  } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
}).listen(port,'127.0.0.1',() => console.log(`Quadra online: http://127.0.0.1:${port}`));
