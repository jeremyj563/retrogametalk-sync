# RetroGameTalk Sync

An always-on, containerized scraper and local repository mirror for `retrogametalk.com/repo/` with adaptive AIMD rate limiting, remote-path filesystem mirroring, filename deduplication, and a retro CRT phosphor web control console.

## Deploying with Helm

A Helm chart is included at `helm/charts/retrogametalk-sync`. All configurable values (persistence, credentials, cron schedule, rate limits, ingress, probes, `podAnnotations`, and console sharding) are documented inline in `helm/charts/retrogametalk-sync/values.yaml`.

### 1. Build the Container Image

```bash
docker build -t retrogametalk-sync:1.0.0 .
```

### 2. Install the Chart

Install with default values (credentials and console filters can then be configured directly in the **Operations** tab):

```bash
helm install rgt-sync ./helm/charts/retrogametalk-sync \
  --namespace rgt-sync \
  --create-namespace
```

Or pass credentials and storage settings at install time (or via a custom `my-values.yaml`):

```bash
helm install rgt-sync ./helm/charts/retrogametalk-sync \
  --namespace rgt-sync \
  --create-namespace \
  --set credentials.username="your-username" \
  --set credentials.password="your-password" \
  --set persistence.size="500Gi"
```

To upgrade an existing release after editing values:

```bash
helm upgrade rgt-sync ./helm/charts/retrogametalk-sync \
  --namespace rgt-sync \
  -f my-values.yaml
```

To uninstall:

```bash
helm uninstall rgt-sync --namespace rgt-sync
```
