# Troubleshooting & Debug Logging Guide

This guide explains how to enable `DEBUG`-level diagnostic logging in `rgt-sync`, inspect low-level subsystem traces, and resolve common scraping, storage, archive-streaming, and SD card installation issues.

---

## 1. Enabling `DEBUG` Logging

By default, `DEBUG` logging is **off** (`false`) so SQLite activity history and container stdout remain concise during routine scheduled syncs. When `DEBUG` is enabled, `rgt-sync` records verbose diagnostic traces across stdout, the SQLite `activity_logs` table, the SSE Live Event Stream, and Chromium SD-card transfer errors.

### Supported Environment Variables

Any of the following environment variables enables app-level debug logging on startup (no rebuild required—restart the container/process after changing):

| Variable | Accepted Values | Notes |
| :--- | :--- | :--- |
| `SCRAPER_DEBUG` | `true` / `false` (or `1` / `0`) | **Primary flag** used by Helm and Docker Compose |
| `RGT_DEBUG` | `true` / `false` | Alias for `SCRAPER_DEBUG` |
| `DEBUG_LOGGING` | `true` / `false` | Explicit boolean alias |
| `LOG_LEVEL` | `debug` or `trace` | Standard level override (`info`/`warn`/`error` keeps debug off) |
| `DEBUG` | `true` / `1` | Strict boolean only—tooling variables such as `DEBUG=vite:*` do **not** trigger noisy `rgt-sync` debug logs |

---

### Option A: Kubernetes / Helm Chart

The Helm chart at `k8s/charts/retrogametalk-sync` exposes `scraper.debug` as a boolean value (defaulting to `false`), which renders `SCRAPER_DEBUG` inside the release `ConfigMap`.

**One-off toggle via `helm upgrade --reuse-values`:**

```bash
helm upgrade rgt-sync ./k8s/charts/retrogametalk-sync \
  --reuse-values \
  --set scraper.debug=true
```

*(Changing the `ConfigMap` requires restarting the StatefulSet pod if Stakater Reloader is not installed:)*

```bash
kubectl rollout restart statefulset/rgt-sync
```

**Or in your custom `values.yaml` override file:**

```yaml
scraper:
  debug: true
```

To turn debug logging back off:

```bash
helm upgrade rgt-sync ./k8s/charts/retrogametalk-sync \
  --reuse-values \
  --set scraper.debug=false
kubectl rollout restart statefulset/rgt-sync
```

---

### Option B: Docker Compose

Pass `SCRAPER_DEBUG=true` in your shell or `.env` file alongside `docker-compose.yml`:

```bash
SCRAPER_DEBUG=true docker compose up -d --force-recreate
```

Or set `SCRAPER_DEBUG=true` inside your container's environment file (`.env`).

---

### Option C: Local Development / Direct Node.js

```bash
SCRAPER_DEBUG=true npm run dev
```

On startup, verify that the boot banner prints `debugLogging=enabled`:

```text
[2026-...] [STARTUP] [INFO] Persistence initialized — ..., debugLogging=enabled
```

---

## 2. Inspecting `DEBUG` Logs

Once `DEBUG` logging is enabled, events are available in four places:

1. **Container / Process Logs (`stdout` / `stderr`)**
   Includes low-level HTTP redirects/timings, cookie jar I/O, rate-limiter backoff decisions, archive extraction spawns (`7z`/`unzip`), disk writes, and client SD-card failures:
   ```bash
   # Kubernetes
   kubectl logs -f statefulset/rgt-sync

   # Docker Compose
   docker compose logs -f rgt-sync
   ```

2. **Web UI — Overview → Live Scraper Event Stream → `Debug` Tab**
   Select the **Debug** filter tab inside the **Live Scraper Event Stream** console on the **Sync** page. New `[debug]` events stream live over `/api/events` (SSE) alongside scraper run history.

3. **REST API (`GET /api/logs?level=debug`)**
   Query persisted SQLite debug entries directly:
   ```bash
   curl -s 'http://localhost:3000/api/logs?level=debug&limit=200' | jq .
   ```
   Check `/api/status` at any time to confirm `"debugLogging": true`.

4. **Browser Developer Console (Client-Side SD Card I/O)**
   During **Direct Handheld / SD Card** installs, Chromium File System Access API operations also emit `[RGT:SD-INSTALL]` traces in the browser's DevTools Console, and failures/folder errors are forwarded to `POST /api/logs/debug` so they appear in server logs and the **Debug** tab.

---

## 3. Diagnostic Subsystem Reference

| Log Prefix | Source Module | What It Traces When `DEBUG` Is Enabled |
| :--- | :--- | :--- |
| `[AUTH]` | `rgtClient.ts` | Cookie jar load/save/prune errors, `Set-Cookie` rejections, mid-crawl login redirects, inline password gates |
| `[HTTP]` | `rgtClient.ts`, `server.ts` | Per-request method/URL/status/latency, `30x` redirect hops, retryable vs. non-retryable network exceptions (`ECONNRESET`, DNS, timeouts), HTTP response stream errors |
| `[SCRAPER]` / `[Crawl]` / `[WP REST]` | `orchestrator.ts`, `rgtClient.ts` | Target system resolution, cutoff timestamps, WP REST `modified_after` / `orderby` fallbacks, 404/non-JSON fallback to HTML crawl, zero-link pages, `#acf-content-wrapper` / `cdr_nonce` token refreshes |
| `[DOWNLOAD]` | `rgtClient.ts`, `orchestrator.ts` | Transfer attempts, response headers (`Content-Type`, `Content-Length`, `Content-Disposition`), `.part` disk write opens, byte-count mismatches, `fs.rename` errors, retry eligibility, link refresh decisions |
| `[RATE_LIMITER]` | `rateLimiter.ts` | Queued throttles >=1.5s, AIMD recovery step-downs, `429`/`503` backoff multipliers & `Retry-After` calculations |
| `[ARCHIVE]` | `archiveService.ts`, `orchestrator.ts` | `7zz`/`7z`/`7za`/`7zip-bin` binary resolution, archive listing counts & fallback to `unzip`, extraction child exit codes & `stderr`, streaming ZIP repacks, RFC 5987 `Content-Disposition` headers |
| `[SD-INSTALL]` | `useBulkStorageInstaller.ts`, `sdCardFs.ts` | Folder picker rejections, FAT32 folder/file handle `DOMException` errors, extraction HTTP errors, chunk inspection failures, old-version cleanup warnings |

---

## 4. Common Errors & How to Diagnose Them

### `{"error":"Invalid character in header content [\"Content-Disposition\"]"}` during ROM Downloads or SD Installs

- **Cause**: Some ROM filenames contain Unicode characters (such as `™`, `©`, em/en-dashes `–`, smart apostrophes `’`, accented Latin letters like `é`, or Japanese/CJK characters). HTTP response headers strictly require printable US-ASCII characters inside legacy `Content-Disposition: attachment; filename="..."` values; Node.js throws `ERR_INVALID_CHAR` if raw UTF-8 characters appear there.
- **Resolution**: Current builds generate a strictly ASCII fallback `filename="..."` paired with an RFC 5987 UTF-8 `filename*=UTF-8''...` parameter (so FAT32/exFAT SD writes keep clean names while Node's header validator never rejects the response).
- **If you still suspect header or extraction issues**: Enable `SCRAPER_DEBUG=true`, retry the affected ROM, and inspect `[ARCHIVE]` and `[HTTP]` entries to see the exact `headerValue`, `7z` exit status, or stream error.

### Archive Extraction Failures (`500` on `/api/items/:id/extract-entry` or `inspect`)

1. Enable `SCRAPER_DEBUG=true` and check `[ARCHIVE]` logs for magic-byte header diagnostics (`RAR4`, `RAR5`, `ZIP`, `7z`, or `HTML`/0-byte error page) and `unrar` / `7z` / `bsdtar` / `unzip` exit codes.
2. Confirm the mirrored archive exists on disk at `DOWNLOAD_DIR/<system>/<release>/<file>` and was not truncated (`0` bytes or an HTML login/error page saved during an upstream hiccup—if magic-byte sniffing reports HTML, re-download the release).
3. Container images bundle native multi-arch `unrar` (for RAR4/RAR5/solid `.rar` files), `7zip`, and `libarchive-tools` (`bsdtar`). On bare-metal local installs, ensure `unrar` or `7z` with RAR codec support is on `PATH` when inspecting `.rar` archives.

### Download Stuck, Failing Mid-Stream, or Queue Auto-Resume Paused

1. Look for `[DOWNLOAD]` debug entries showing `code=ENOSPC` (disk full), `code=EACCES` / `code=EPERM` (PVC volume permissions), or `Byte count differs from Content-Length`.
2. Ensure the container UID/GID (`1000:100` by default) has write permissions to `persistence.mountPath` (`/run/repo`) and `DATA_DIR` (`/run/repo/.rgt-data`).
3. If an active download queue is interrupted unexpectedly (`SIGTERM`, `SIGKILL`, OOM kill, or container upgrade), `rgt-sync` automatically resumes it on startup using an exponential backoff (`5s → 15s → 45s → 2m → 5m`). If the server crashes 5 consecutive times rapidly, the **circuit breaker** pauses auto-resume to prevent a reboot loop—fix the underlying issue (e.g., container memory limit or full disk), then click **Resume Queue** in the **Sync** or **Catalog** recovery strip.

### Mount Storage Device Unavailable (`HTTPS Req` or `Unsupported`)

1. Direct browser-to-SD-card writing requires a **Chromium-based browser** (Chrome, Edge, Brave, Vivaldi, Arc, Opera) running in a **secure context** (`https://...` or `http://localhost` / `http://127.0.0.1`).
2. If you access your homelab server over plain LAN HTTP (e.g., `http://192.168.1.50:3000`), terminate TLS in front of `rgt-sync` (Caddy, Traefik, Nginx Proxy Manager, Kubernetes Ingress, or Tailscale HTTPS) or add your LAN origin to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`—otherwise one-click **Download ROM** still works in every browser.

### Scraper Finding 0 Releases or Auth Expiring Mid-Run

1. Look for `[AUTH]` and `[WP REST]` debug lines in container stdout or the **Debug** tab.
2. Common causes:
   - Incremental cutoff timestamp (`lastWatermarkAt`) is newer than all posts on the selected console—clear or backdate it in **Sync Rules** (or **Sync → Incremental Cutoff**).
   - Cloudflare or WordPress returned a non-JSON challenge or login form (`Auth wall detected on dynamic download AJAX` / `Blocked by Cloudflare bot protection`). Re-verify credentials in **System Settings**.
   - If a console looks empty or stale, click **Full Re-index** in **Catalog** or **Sync Rules** to force a fresh page-1-to-N WordPress REST rebuild.
