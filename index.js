const http = require('http');
const https = require('https');
const fs = require('fs');

// ─── Config (persisted to disk) ──────────────────────────────────────────────
const CONFIG_FILE = process.env.CONFIG_FILE || './config.json';

const defaults = {
  targetHost:   process.env.TARGET_HOST   || 'yoru.midwesteagle.com',
  spoofReferer: process.env.SPOOF_REFERER  || 'https://cineby.sc',
  spoofOrigin:  process.env.SPOOF_ORIGIN   || 'https://cineby.sc',
  apiSecret:    process.env.API_SECRET     || '',
};

let config;
try { config = { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; }
catch { config = { ...defaults }; }

function save() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shouldRewrite(ct, url) {
  ct = (ct || '').toLowerCase();
  if (ct.includes('text/') || ct.includes('mpegurl') || ct.includes('m3u') ||
      ct.includes('json') || ct.includes('xml') || ct.includes('javascript') || ct.includes('vtt')) return true;
  return /\.(m3u8?|txt|html|xml|json|js|vtt|srt)(\?|$)/i.test(url);
}

function rewrite(text, myHost) {
  const t = config.targetHost;
  let result = text
    .replaceAll(`https://${t}`, `https://${myHost}`)
    .replaceAll(`http://${t}`,  `http://${myHost}`)
    .replaceAll(t,              myHost);

  if (result.includes('#EXTM3U') && !result.includes('#EXT-X-ENDLIST')) {
    result = result.trimEnd() + '\n#EXT-X-ENDLIST\n';
  }

  if (result.includes('#EXT-X-PLAYLIST-TYPE:EVENT')) {
    result = result.replace('#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-PLAYLIST-TYPE:VOD');
  }

  return result;
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ─── Server ──────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const myHost = req.headers['host'];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    return res.end();
  }

  // ── API: change domain ─────────────────────────────────────────────────
  if (req.url.startsWith('/api/new')) {
    const params = new URL(req.url, `http://${myHost}`).searchParams;
    if (config.apiSecret && params.get('secret') !== config.apiSecret) return json(res, 403, { error: 'Invalid ?secret=' });
    const d = params.get('d');
    if (!d) return json(res, 400, { error: 'Missing ?d= — /api/new?d=newdomain.com' });
    const old = config.targetHost;
    config.targetHost = d.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    save();
    return json(res, 200, { success: true, previousHost: old, currentHost: config.targetHost });
  }

  // ── API: status ────────────────────────────────────────────────────────
  if (req.url.startsWith('/api/status')) {
    const params = new URL(req.url, `http://${myHost}`).searchParams;
    if (config.apiSecret && params.get('secret') !== config.apiSecret) return json(res, 403, { error: 'Invalid ?secret=' });
    return json(res, 200, { targetHost: config.targetHost, spoofReferer: config.spoofReferer, spoofOrigin: config.spoofOrigin });
  }

  // ── Health ─────────────────────────────────────────────────────────────
  if (req.url === '/health') return json(res, 200, { status: 'ok' });

  // ── Proxy ──────────────────────────────────────────────────────────────
  const parsed = new URL(req.url, `http://${myHost}`);
  const path = parsed.pathname;
  const search = parsed.search;

  let targetUrl;
  if (path === '/video.m3u8' || path === '/') {
    const p = new URLSearchParams(search);
    p.delete('type');
    const qs = p.toString();
    targetUrl = `https://${config.targetHost}/${qs ? '?' + qs : ''}`;
  } else {
    targetUrl = `https://${config.targetHost}${path}${search}`;
  }

  const targetParsed = new URL(targetUrl);
  const isHTTPS = targetParsed.protocol === 'https:';
  const lib = isHTTPS ? https : http;

  const headers = { ...req.headers };
  headers['host'] = targetParsed.host;
  headers['referer'] = config.spoofReferer;
  headers['origin'] = config.spoofOrigin;
  delete headers['cf-connecting-ip']; delete headers['cf-ray'];
  delete headers['x-forwarded-for'];  delete headers['x-real-ip'];

  const proxyReq = lib.request({
    hostname: targetParsed.hostname,
    port: targetParsed.port || (isHTTPS ? 443 : 80),
    path: targetParsed.pathname + targetParsed.search,
    method: req.method,
    headers,
    rejectUnauthorized: false,
  }, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || '';
    const isText = shouldRewrite(ct, req.url);
    const respHeaders = { ...proxyRes.headers };
    respHeaders['access-control-allow-origin'] = '*';
    respHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    respHeaders['access-control-allow-headers'] = '*';

    if (respHeaders['location']) respHeaders['location'] = rewrite(respHeaders['location'], myHost);
    delete respHeaders['transfer-encoding'];

    if (isText) {
      const chunks = [];
     proxyRes.on('end', () => {
  const raw = Buffer.concat(chunks);

  let body;
  if (raw[0] === 0xFF && raw[1] === 0xFE) {
    body = raw.slice(2).toString('utf16le');
  } else if (raw[0] === 0xFE && raw[1] === 0xFF) {
    body = raw.swap16().slice(2).toString('utf16le');
  } else {
    body = raw.toString('utf8');
  }

  body = rewrite(body, myHost);
  respHeaders['content-length'] = Buffer.byteLength(body);
  respHeaders['content-type'] = 'application/vnd.apple.mpegurl; charset=utf-8';
  res.writeHead(proxyRes.statusCode, respHeaders);
  res.end(body);
});
    } else {
      res.writeHead(proxyRes.statusCode, respHeaders);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('error', err => {
    if (!res.headersSent) json(res, 502, { error: 'Proxy error: ' + err.message });
  });

  if (req.method !== 'GET' && req.method !== 'HEAD') req.pipe(proxyReq);
  else proxyReq.end();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Stream proxy running on :${PORT} → ${config.targetHost}`);
  console.log(`Change domain: /api/new?d=newdomain.com`);
});
