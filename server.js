const express = require('express');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

const TARGET_HOST = 'yoru.midwesteagle.com';
const SPOOF_REFERER = 'https://cineby.sc';
const SPOOF_ORIGIN = 'https://cineby.sc';

function shouldRewriteBody(contentType, urlStr) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('text/')) return true;
  if (ct.includes('mpegurl')) return true;
  if (ct.includes('m3u')) return true;
  if (ct.includes('json')) return true;
  if (ct.includes('xml')) return true;
  if (ct.includes('javascript')) return true;
  if (ct.includes('vtt')) return true;
  return /\.(m3u8?|txt|html|xml|json|js|vtt|srt)(\?|$)/i.test(urlStr);
}

app.use(express.raw({ type: '*/*', limit: '50mb' }));

app.all('*', async (req, res) => {
  const pathname = req.path;
  const search = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  
  let targetUrl;
  
  if (pathname === '/video.m3u8' || pathname === '/') {
    const params = new URLSearchParams(search);
    params.delete('type');
    const qs = params.toString();
    targetUrl = `https://${TARGET_HOST}/${qs ? '?' + qs : ''}`;
  } else {
    targetUrl = `https://${TARGET_HOST}${pathname}${search}`;
  }

  const headers = {
    'Referer': SPOOF_REFERER,
    'Origin': SPOOF_ORIGIN,
    'Host': TARGET_HOST,
    ...req.headers
  };
  delete headers['host'];
  headers['Host'] = TARGET_HOST;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      redirect: 'follow'
    });

    const contentType = response.headers.get('content-type') || '';
    const isText = shouldRewriteBody(contentType, req.url);

    let body;
    if (isText) {
      let text = await response.text();
      const workerHost = req.get('host');
      text = text
        .replaceAll(`https://${TARGET_HOST}`, `https://${workerHost}`)
        .replaceAll(`http://${TARGET_HOST}`, `http://${workerHost}`)
        .replaceAll(TARGET_HOST, workerHost);
      body = text;
    } else {
      body = await response.buffer();
    }

    // Set response headers
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.set('Access-Control-Allow-Headers', '*');

    // Copy headers from upstream
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
        res.set(key, value);
      }
    });

    // Handle redirects
    const location = response.headers.get('location');
    if (location) {
      const workerHost = req.get('host');
      const newLocation = location
        .replace(`https://${TARGET_HOST}`, `https://${workerHost}`)
        .replace(`http://${TARGET_HOST}`, `http://${workerHost}`)
        .replace(TARGET_HOST, workerHost);
      res.set('location', newLocation);
    }

    res.status(response.status).send(body);

  } catch (err) {
    res.status(502).send('Proxy fetch error: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
