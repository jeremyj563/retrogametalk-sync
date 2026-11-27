# Deploying on Kubernetes & Helm

**RetroGameTalk Sync** includes a production-ready Helm chart at [`k8s/charts/retrogametalk-sync`](../../k8s/charts/retrogametalk-sync) built around a **`StatefulSet`**, `PersistentVolumeClaim`, Kubernetes `Secret` support, liveness/readiness probes, Ingress, and Prometheus scraping annotations.

> [!NOTE]
> **Why a `StatefulSet`?** `rgt-sync` writes to a single-writer SQLite WAL database (`scraper.db`) and streams multi-gigabyte `.part` files onto persistent storage. A `StatefulSet` guarantees ordered termination (`terminationGracePeriodSeconds: 30`), prevents `ReadWriteOnce` multi-attach deadlocks across nodes, and provides a stable `POD_ID` surfaced in telemetry.

---

## 1. Prerequisites

- Kubernetes `1.24+` (k3s, Talos, MicroK8s, Kind, EKS, GKE, etc.)
- `helm` v3.12+
- A default `StorageClass` supporting `ReadWriteOnce` (or `ReadWriteMany` for sharded multi-pod setups)

---

## 2. Installing the Helm Chart

### Option A — Install From Local Chart Directory

```bash
git clone https://github.com/jeremyj563/retrogametalk-sync.git
cd retrogametalk-sync

# Install with defaults (configure credentials interactively in Web UI)
helm install rgt-sync ./k8s/charts/retrogametalk-sync \
  --namespace rgt-sync \
  --create-namespace
```

### Option B — Install From GHCR OCI Registry *(Tagged Releases)*

On tagged `1.x.y` releases, CI packages and pushes the Helm chart to GHCR OCI:

```bash
helm install rgt-sync oci://ghcr.io/jeremyj563/charts/retrogametalk-sync \
  --version 1.44.4 \
  --namespace rgt-sync \
  --create-namespace
```

After install or upgrade, Helm `NOTES.txt` prints the deployed version, chart version, resolved container image reference, console URL, and health/metrics endpoints.

### Quick Access via Port-Forward

```bash
kubectl --namespace rgt-sync port-forward svc/rgt-sync 3000:3000
# Open http://127.0.0.1:3000
```

---

## 3. Production `my-values.yaml` Example

Create a custom `my-values.yaml` (see [`k8s/charts/retrogametalk-sync/examples/overrides.yaml`](../../k8s/charts/retrogametalk-sync/examples/overrides.yaml) and [`values.yaml`](../../k8s/charts/retrogametalk-sync/values.yaml) for every option):

```yaml
image:
  repository: ghcr.io/jeremyj563/retrogametalk-sync
  tag: "1.44.4"
  pullPolicy: IfNotPresent

persistence:
  enabled: true
  storageClass: ""          # Empty uses cluster default
  accessMode: ReadWriteOnce
  size: 500Gi

credentials:
  existingSecret: rgt-sync-credentials   # Recommended over plaintext values

ingress:
  enabled: true
  className: nginx
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"
  hosts:
    - host: rgt-sync.home.arpa
      paths:
        - path: /
          pathType: Prefix

scraper:
  cronSchedule: "0 */6 * * *"
  scheduleEnabled: "true"
  debug: false

metrics:
  prometheusScrape: true

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 1000m
    memory: 1Gi
```

### Using `credentials.existingSecret` (Recommended)

Keep credentials, your AES-256-GCM key, and optional dashboard lock secrets out of Helm release history:

```bash
kubectl --namespace rgt-sync create secret generic rgt-sync-credentials \
  --from-literal=RGT_USERNAME="your-username" \
  --from-literal=RGT_PASSWORD="your-password" \
  --from-literal=ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  --from-literal=APP_AUTH_PASSWORD="" \
  --from-literal=APP_AUTH_SESSION_SECRET="$(openssl rand -hex 32)"

helm upgrade --install rgt-sync ./k8s/charts/retrogametalk-sync \
  --namespace rgt-sync \
  --create-namespace \
  -f my-values.yaml
```

---

## 4. Horizontal Console Sharding (`ReadWriteMany`)

Operators mirroring multi-terabyte collections can run separate Helm releases per console group against shared `ReadWriteMany` storage (using `persistence.existingClaim`), passing distinct `scraper.systemFilter` allowlists:

```bash
# Release 1: Cartridge consoles
helm install rgt-cartridges ./k8s/charts/retrogametalk-sync \
  -n rgt-sync \
  --set persistence.existingClaim=rgt-shared-rwx-pvc \
  --set scraper.systemFilter="nes,snes,gba,n64,genesis"

# Release 2: Optical disc consoles
helm install rgt-optical ./k8s/charts/retrogametalk-sync \
  -n rgt-sync \
  --set persistence.existingClaim=rgt-shared-rwx-pvc \
  --set scraper.systemFilter="psx,ps2,psp,dreamcast,gamecube"
```

---

## 5. Health Probes & Prometheus Metrics

- **Liveness Probe:** `GET /healthz` (`initialDelaySeconds: 10`, `periodSeconds: 30`)
- **Readiness Probe:** `GET /readyz` — checks SQLite readiness and confirms `/run/repo` is writable (returns `503` if your CSI/NFS storage disconnects)
- **Prometheus Metrics:** `GET /metrics` (`prometheus.io/scrape: "true"`, port `3000`, path `/metrics` automatically annotated on Pod templates)

---

## 6. Upgrading & Uninstalling

```bash
# Upgrade an existing release
helm upgrade rgt-sync ./k8s/charts/retrogametalk-sync \
  --namespace rgt-sync \
  -f my-values.yaml

# Uninstall (PVC is retained by Kubernetes unless deleted explicitly)
helm uninstall rgt-sync --namespace rgt-sync
```
