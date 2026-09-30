# Deployment

## Status

Production is deployed on Vercel at
`https://wooden-bom-builder.vercel.app`. The Vercel project root is `source/`.
The repository root intentionally contains documentation and the stone
reference implementation as well as the deployable app.

## Requirements

- **Node 20+** (Next 16, React 19)
- No database, no Redis, no queue
- Writable OS temp directory for the Zoho token cache
- Outbound HTTPS to `*.zoho.in` (or your region) and optionally `api.openai.com`

## Build

```bash
cd source
npm ci
npm run build
npm start        # serves on 127.0.0.1:3000
```

### The WASM compiler quirk

Inherited from stone and easy to break. `package.json` pins
`@next/swc-wasm-nodejs` and the scripts pass `--webpack` with
`NEXT_TEST_WASM_DIR` set:

```json
"dev":   "NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next dev --webpack -H 127.0.0.1",
"build": "NEXT_TEST_WASM_DIR=$PWD/node_modules/@next/swc-wasm-nodejs next build --webpack"
```

Next runs on the WASM compiler rather than the native SWC binary. **Keep both
the flag and the env var** or the build will try to fetch a native binary. This
also makes builds slower than a stock Next project — expect it.

### Host binding

Both `dev` and `start` bind `-H 127.0.0.1`. Correct behind a reverse proxy on
the same host; wrong in a container, where you need `0.0.0.0`.

## Docker

None exists. A working starting point:

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY source/package*.json ./
RUN npm ci
COPY source/ .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
EXPOSE 3000
CMD ["npx","next","start","-H","0.0.0.0"]
```

Note the `-H 0.0.0.0` override. Pass secrets at runtime, never bake them in.

## Reverse proxy

```nginx
server {
  listen 443 ssl http2;
  server_name bom.magppie.example;

  ssl_certificate     /etc/letsencrypt/live/.../fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/.../privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

**Do not expose this publicly until D1 and D2 in `BUGS.md` are fixed.** The API
routes are unauthenticated and the app password sits in the client bundle. A
public deployment hands anyone a proxy into your Zoho org.

## CI/CD

None configured. Minimum viable pipeline:

```yaml
- npm ci
- npx tsc --noEmit          # expect 2 inherited BomDashboard errors
- node tools/smoke/run.js   # assert the reference figure
- npm run build
```

Gate deploys on the smoke harness reproducing **22.978 sqft / 11.806 RMT**.

## Environment

Four Zoho variables, one optional OpenAI key. See `ENVIRONMENT.md`. Use the
platform's secret store; do not ship a `.env` file inside the image.

## Monitoring, logging, backup

**Monitoring.** None. `GET /api/zoho/status` is a ready-made health check —
point an uptime monitor at it, since it verifies the Zoho token exchange rather
than just that the process is alive.

**Logging.** `console.log` only, notably `[RawMat]` traces through the
resolution path. No structured logging, no aggregation, no error tracking.
Adding Sentry or equivalent is a backlog item.

**Backup.** Nothing to back up. Zoho holds all state. The token cache and
`localStorage` are both disposable.
