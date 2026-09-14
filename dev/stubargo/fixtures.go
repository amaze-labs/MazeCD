package main

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"time"
)

// App is one fixture ArgoCD Application, kept in memory for the life of the
// stub. Only Health/Sync/OperationPhase ever change (the demo cycler in
// main.go flips one per instance every few seconds); everything else is
// fixed so successive `npm run shoot` runs produce comparable screenshots.
type App struct {
	Name                string
	Instance            string
	Project             string
	Health              string // Healthy | Progressing | Degraded | Suspended | Unknown
	HealthMessage       string
	Sync                string // Synced | OutOfSync
	OperationPhase      string // "" | "Running"
	Revision            string
	OperationFinishedAt time.Time // when the last sync finished; varies per app
	ResourceCount       int       // status.resources length
	UnhealthyResources  int       // of ResourceCount, how many report non-Healthy
	RepoURL             string    // spec.source.repoURL
	TargetRevision      string    // spec.source.targetRevision
	AutoSync            bool      // spec.syncPolicy.automated presence
}

// homeApps, ordersApps and utilityApps are real-looking fleet names: a
// homelab, a ledger platform's own services, and the shared cluster
// utilities every namespace depends on. 45 + 30 + 24 = 99.
var homeApps = []string{
	"inventory-web", "inventory-db", "link-archive", "sensor-dashboard", "vault-backup",
	"photo-index", "image-updater", "photo-library", "photo-library-ml", "doc-archive",
	"doc-archive-db", "automation-hub", "flow-engine", "mqtt-broker", "zigbee-bridge",
	"device-firmware", "network-controller", "dns-sinkhole", "dns-filter", "vpn-ui",
	"password-store", "git-server", "git-runner", "media-server", "series-manager",
	"film-manager", "index-manager", "subtitle-fetcher", "transfer-client", "request-portal",
	"stream-stats", "uptime-monitor", "push-relay", "file-sync", "file-share",
	"file-share-db", "file-share-redis", "grafana", "prometheus", "alertmanager",
	"loki", "promtail", "container-ui", "start-page", "page-watcher",
}

var ordersApps = []string{
	"orders-api", "orders-front", "orders-worker", "orders-webhook", "orders-clock",
	"orders-pdf", "orders-events-processor", "orders-ledger-analytics-exporter", "clickhouse", "clickhouse-keeper",
	"temporal", "temporal-ui", "redis-orders", "postgres-orders", "smtp-sink",
	"grafana-orders", "s3-proxy", "webhook-relay", "document-renderer", "usage-aggregator-cron",
	"retry-worker", "metering-pipeline-consumer", "portal-bff", "tax-calculation-service", "payment-gateway-adapter",
	"subscription-lifecycle-controller", "revenue-recognition-batch-job", "dead-letter-queue-reprocessor", "orders-migrations-job", "orders-docs",
}

var utilityApps = []string{
	"argocd", "cert-manager", "external-secrets", "sealed-secrets", "ingress-nginx",
	"external-dns", "cluster-autoscaler", "metrics-server", "kube-state-metrics", "node-exporter",
	"velero", "reloader", "longhorn", "minio", "vault",
	"consul", "platform-ingress-controller-prod", "platform-ingress-controller-staging", "cost-monitoring-exporter-daemon", "backup-verification-cronjob-runner",
	"log-aggregation-pipeline-collector", "network-policy-controller-validator-webhook", "certificate-rotation-daemonset-controller", "image-pull-secret-sync-operator",
}

// abnormal pins the fleet's ~8 non-nominal applications to fixed names, so
// the "97 fine things, 2 on fire" ratio the task cares about is exact and
// reproducible rather than randomly reshuffled on every run.
var abnormal = map[string]App{
	"photo-library-ml": {
		Health: "Degraded", Sync: "Synced", HealthMessage: "readiness probe failed",
	},
	"platform-ingress-controller-prod": {
		Health: "Degraded", Sync: "Synced", HealthMessage: "ImagePullBackOff: back-off pulling image",
	},
	"doc-archive":                      {Health: "Healthy", Sync: "OutOfSync"},
	"orders-worker":                        {Health: "Healthy", Sync: "OutOfSync"},
	"cert-manager":                       {Health: "Healthy", Sync: "OutOfSync"},
	"file-share":                          {Health: "Progressing", Sync: "Synced", OperationPhase: "Running"},
	"image-updater":                         {Health: "Suspended", Sync: "Synced"},
	"log-aggregation-pipeline-collector": {Health: "Unknown", Sync: "Synced"},
}

// manual pins the fleet's handful of applications that ArgoCD will NOT
// reconcile by itself -- spec.syncPolicy.automated absent. Most of the fleet
// autosyncs; these are the exception. doc-archive, cert-manager and
// orders-worker are already OutOfSync above, which is exactly what "nobody
// synced it" looks like. prometheus, postgres-orders and velero are otherwise
// perfectly Healthy/Synced -- the case that matters most, since a manual app
// that is currently fine gives no visual hint that a future drift will just
// sit there until someone acts.
var manual = map[string]bool{
	"doc-archive": true, "cert-manager": true, "orders-worker": true,
	"prometheus": true, "postgres-orders": true, "velero": true,
}

// demoApps names the one application per instance the stream/watch demo
// cycles (see cycler in main.go). Each is deliberately not one of the pinned
// abnormal apps above, so the fixed ratio the screenshots depend on never
// drifts by more than the cycler's own one-per-instance. One per instance,
// not one overall, so a harness can watch two instances keep updating while
// the third one's stream is broken.
var demoApps = map[string]string{"home": "grafana", "orders": "grafana-orders", "utility": "vault"}

// revision fakes a deterministic 40-char git sha from the app name, so the
// same fixture always shows the same "revision" across runs.
func revision(name string) string {
	sum := sha1.Sum([]byte(name))
	return hex.EncodeToString(sum[:])
}

// buildTime is the point every "how long ago" fixture value is computed
// relative to. Fixed once at process start rather than re-read per request,
// so a single `npm run shoot` run sees consistent ages.
var buildTime = time.Now().UTC()

// ageFor spreads an app's last-operation age from ~5 minutes to ~30 days,
// deterministically from its name, so rows show genuinely different
// "deployed" times instead of all reading "just now".
func ageFor(name string) time.Duration {
	sum := sha1.Sum([]byte(name))
	minutes := 5 + int(sum[0])*170 // sum[0] in [0,255] -> ~5min .. ~30 days
	return time.Duration(minutes) * time.Minute
}

// resourceCountFor spreads status.resources length from 3 to 20,
// deterministically from the app name.
func resourceCountFor(name string) int {
	sum := sha1.Sum([]byte(name))
	return 3 + int(sum[1])%18
}

// Each instance deploys from its own repository at its own target revision,
// and the three are deliberately unalike: an SSH remote, an HTTPS one, and a
// long self-hosted URL, pinned to a branch, a tag and a release branch. The
// home repository is the longest on purpose -- it is the one the detail
// screenshot shows, and a REPOSITORY field that never truncates in any
// screenshot is a truncation nobody has seen.
type origin struct {
	repo   string
	target string
}

var origins = map[string]origin{
	"home":    {"git@github.com:amaze-labs/homelab-gitops-manifests.git", "main"},
	"orders":    {"https://git.orders.internal/platform/ledger-manifests.git", "v1.24.3"},
	"utility": {"git@github.com:amaze-labs/cluster-utilities.git", "release-2026.03"},
}

func buildApps() []*App {
	all := make([]*App, 0, 99)
	add := func(instance string, names []string, project string) {
		o := origins[instance]
		for _, n := range names {
			a := &App{
				Name:                n,
				Instance:            instance,
				Project:             project,
				Health:              "Healthy",
				Sync:                "Synced",
				Revision:            revision(n),
				OperationFinishedAt: buildTime.Add(-ageFor(n)),
				ResourceCount:       resourceCountFor(n),
				RepoURL:             o.repo,
				TargetRevision:      o.target,
				AutoSync:            !manual[n],
			}
			if o, ok := abnormal[n]; ok {
				a.Health, a.Sync, a.OperationPhase, a.HealthMessage = o.Health, o.Sync, o.OperationPhase, o.HealthMessage
			}
			// Only apps actually on fire carry unhealthy resources -- most
			// applications, including the merely OutOfSync/Progressing/
			// Suspended/Unknown ones above, report zero.
			if a.Health == "Degraded" {
				sum := sha1.Sum([]byte(n))
				unhealthy := 1 + int(sum[2])%3
				if unhealthy > a.ResourceCount {
					unhealthy = a.ResourceCount
				}
				a.UnhealthyResources = unhealthy
			}
			all = append(all, a)
		}
	}
	// No instance shares its name with its project. They are different facts
	// -- which server an application lives on, and which ArgoCD project it
	// belongs to -- and a fixture where they read alike ("home" / "home")
	// hides exactly the confusion a screenshot is supposed to expose.
	add("home", homeApps, "personal")
	add("orders", ordersApps, "ledger")
	add("utility", utilityApps, "platform")
	if len(all) != 99 {
		panic(fmt.Sprintf("stubargo: fixture count drifted: got %d apps, want 99", len(all)))
	}
	return all
}

func byInstance(apps []*App) map[string][]*App {
	out := map[string][]*App{"home": {}, "orders": {}, "utility": {}}
	for _, a := range apps {
		out[a.Instance] = append(out[a.Instance], a)
	}
	return out
}
