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

1. Enable `SCRAPER_DEBUG=true` and check `[ARCHIVE]` logs for `7z` or `unzip` spawn errors or non-zero exit codes.
2. Confirm the mirrored archive exists on disk at `DOWNLOAD_DIR/<system>/<release>/<file>` and was not truncated (`0` bytes or `.part` left behind).
3. If using `.7z` or `.rar`, confirm `Resolved 7-Zip binary ...` appears in `[ARCHIVE]` debug logs; `unzip` only handles `.zip` files.

### Download Stuck, Failing Mid-Stream, or `.part` Disk Errors

1. Look for `[DOWNLOAD]` debug entries showing `code=ENOSPC` (disk full), `code=EACCES` / `code=EPERM` (PVC volume permissions), or `Byte count differs from Content-Length`.
2. Ensure the container UID/GID (`1000:100` by default) has write permissions to `persistence.mountPath` (`/run/repo`) and `DATA_DIR` (`/run/repo/.rgt-data`).
3. Note that `.part` files are automatically removed if a transfer fails or the pod receives `SIGTERM` (within `terminationGracePeriodSeconds`).

### Scraper Finding 0 Releases or Auth Expiring Mid-Run

1. Look for `[AUTH]` and `[WP REST]` debug lines in container stdout or the **Debug** tab.
2. Common causes:
   - Incremental cutoff timestamp (`lastWatermarkAt`) is newer than all posts on the selected console—clear or backdate it in **Sync Rules** (or **Overview → Incremental Cutoff**).
   - Cloudflare or WordPress returned a non-JSON challenge or login form (`Auth wall detected on dynamic download AJAX` / `Blocked by Cloudflare bot protection`). Re-verify credentials in **System Settings**.
