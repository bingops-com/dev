// Private VM gateway. Nginx authenticates every request; this listener is loopback-only.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const defaultPortal = process.env.DEV_WEB_ROOT ? pathToFileURL(resolve(process.env.DEV_WEB_ROOT, 'index.html')) : new URL('./web/index.html', import.meta.url);
export function routeHost(host = '') {
  const match = /^([1-9]\d*)\.dev\.lab\.bingo$/.exec(host.toLowerCase());
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1024 && port <= 65535 ? { port, host: `${port}.dev.lab.bingo` } : null;
}

// Never pass the SSO identity or its session cookies to project applications.
function projectHeaders(req, upgrade = false) {
  const headers = { ...req.headers, 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host };
  for (const name of Object.keys(headers)) {
    if (name.startsWith('x-authentik-') || name.startsWith('x-auth-request-') || name === 'proxy-authorization') delete headers[name];
  }
  if (headers.cookie) headers.cookie = headers.cookie.split(';').filter(value => !/^\s*(authentik_|coder_)/i.test(value)).join(';');
  if (!upgrade) { delete headers.connection; delete headers.upgrade; }
  return headers;
}

export function createGateway({ agentPort = 4175, portal = defaultPortal, owner = 'bingops', inventoryCacheMs = 1000 } = {}) {
  if (!Number.isInteger(agentPort) || agentPort < 1024 || agentPort > 65535) throw Error('Invalid agent port');
  let cached, expires = 0, loading;
  async function inventory() {
    if (cached && Date.now() < expires) return cached;
    if (loading) return loading;
    loading = (async () => {
      const response = await fetch(`http://127.0.0.1:${agentPort}/api/dev/status`, { signal: AbortSignal.timeout(3000), redirect: 'error' });
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw Error('Agent unavailable');
      const reader = response.body.getReader(); let bytes = 0, body = '';
      const decoder = new TextDecoder();
      while (true) {
        const {value, done} = await reader.read(); if (done) break;
        bytes += value.byteLength; if (bytes > 131072) { await reader.cancel(); throw Error('Inventory too large'); }
        body += decoder.decode(value, {stream:true});
      }
      const data = JSON.parse(body + decoder.decode());
      if (!Array.isArray(data.ports) || data.ports.length > 64 || !data.ports.every(p => Number.isInteger(p.port) && p.port >= 1024 && p.port <= 65535 && typeof p.project === 'string') || !Array.isArray(data.projects)) throw Error('Invalid inventory');
      cached = data; expires = Date.now() + inventoryCacheMs; return data;
    })().finally(() => { loading = undefined; });
    return loading;
  }
  async function target(host) {
    const route = routeHost(host);
    if (!route) return null;
    if (route.port !== agentPort && !(await inventory()).ports.some(p => p.port === route.port)) return null;
    return route.port;
  }
  const authorized = req => req.headers['x-authentik-username'] === owner;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/healthz' && req.headers.host === 'dev.lab.bingo') { res.writeHead(200); res.end('ok'); return; }
    if (!authorized(req)) { res.writeHead(401, {'cache-control':'no-store'}); res.end('Authentication required'); return; }
    const dashboard = req.headers.host === 'dev.lab.bingo';
    if (dashboard) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const path = req.url.split('?')[0];
      if (path === '/api/workspace') {
        try { const data = await inventory(); res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)); }
        catch { res.writeHead(503, {'content-type':'application/json','cache-control':'no-store'}); res.end('{"error":"environment_unavailable"}'); }
        return;
      }
      const assets = {'/':['index.html','text/html; charset=utf-8'], '/dev.css':['dev.css','text/css; charset=utf-8'], '/dev.js':['dev.js','text/javascript; charset=utf-8'], '/fonts/display.woff2':['fonts/display.woff2','font/woff2'], '/fonts/display-ext.woff2':['fonts/display-ext.woff2','font/woff2'], '/fonts/text.woff2':['fonts/text.woff2','font/woff2'], '/fonts/text-ext.woff2':['fonts/text-ext.woff2','font/woff2']};
      const asset = assets[path];
      if (!asset) { res.writeHead(404); res.end(); return; }
      try {
        const body = await readFile(new URL(asset[0], portal));
        res.writeHead(200, {'content-type':asset[1], 'cache-control':'no-cache', 'x-content-type-options':'nosniff', 'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch { res.writeHead(503); res.end('Portal unavailable'); }
      return;
    }
    let port;
    try { port = await target(req.headers.host); } catch { res.writeHead(503); res.end('Discovery unavailable'); return; }
    if (!port) { res.writeHead(404); res.end('Project port unavailable'); return; }
    const proxy = http.request({hostname:'127.0.0.1',port,method:req.method,path:req.url,headers:projectHeaders(req),timeout:10000}, response => {
      res.writeHead(response.statusCode, response.headers); response.on('error', () => res.destroy()); response.pipe(res);
    });
    proxy.on('timeout', () => proxy.destroy());
    proxy.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('Project unavailable'); } else res.destroy(); });
    req.on('aborted', () => proxy.destroy()); res.on('close', () => proxy.destroy()); req.pipe(proxy);
  });
  server.on('upgrade', async (req, socket, head) => {
    if (!authorized(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    let port;
    try { port = await target(req.headers.host); } catch { socket.end('HTTP/1.1 503 Unavailable\r\nConnection: close\r\n\r\n'); return; }
    if (!port) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    const proxy = http.request({hostname:'127.0.0.1',port,path:req.url,headers:projectHeaders(req,true),timeout:10000});
    proxy.on('timeout', () => proxy.destroy());
    proxy.on('upgrade', (response, remote, remoteHead) => {
      remote.setTimeout(0);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).flatMap(([key,value]) => (Array.isArray(value) ? value : [value]).map(item => `${key}: ${item}\r\n`)).join('')}\r\n`);
      if (head.length) remote.write(head); if (remoteHead.length) socket.write(remoteHead);
      remote.on('error', () => socket.destroy()); socket.on('error', () => remote.destroy());
      remote.on('close', () => socket.destroy()); socket.on('close', () => remote.destroy());
      socket.on('end', () => remote.end()); remote.on('end', () => socket.end()); remote.pipe(socket); socket.pipe(remote);
    });
    proxy.on('response', response => { socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`); response.resume(); });
    proxy.on('error', () => socket.destroy()); socket.on('error', () => proxy.destroy()); proxy.end();
  });
  return server;
}
export const isEntrypoint = (entry, moduleUrl = import.meta.url) => !!entry && moduleUrl === pathToFileURL(realpathSync(entry)).href;
if (isEntrypoint(process.argv[1])) createGateway({owner:process.env.DEV_OWNER || 'bingops'}).listen(8080, '127.0.0.1');
