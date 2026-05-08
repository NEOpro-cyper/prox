# Stream Proxy

Nginx-based reverse proxy for streaming with a dynamic domain API. Deploy on Coolify.

## Deploy on Coolify

1. Push this repo to GitHub
2. Coolify → **New Resource** → **Application** → paste repo URL
3. Coolify detects `docker-compose.yml` automatically
4. Hit **Deploy**

That's it. Your proxy is live on port 3000.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TARGET_HOST` | `yoru.midwesteagle.com` | Upstream domain to proxy |
| `SPOOF_REFERER` | `https://cineby.sc` | Referer header |
| `SPOOF_ORIGIN` | `https://cineby.sc` | Origin header |
| `API_SECRET` | *(empty)* | Lock /api with `?secret=` |

## API

### Change target domain (zero downtime)

```
GET /api/new?d=newdomain.com
```

### View current config

```
GET /api/status
```

### With API_SECRET

```
GET /api/new?d=newdomain.com&secret=yoursecret
GET /api/status?secret=yoursecret
```

## How it works

```
Client → Nginx (:3000) → TARGET_HOST:443
            │
            ├── sub_filter rewrites URLs in m3u8/json/vtt
            ├── proxy_redirect rewrites Location headers
            ├── CORS headers on all responses
            │
            └── /api/* → Node.js sidecar (:3001, internal)
```

When you hit `/api/new?d=...`, the Node sidecar rewrites the Nginx config and does `nginx -s reload` — no container restart, no dropped connections. Config is persisted in a Docker volume.
