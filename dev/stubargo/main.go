// Command stubargo is a fixture ArgoCD API server for developing MazeCD
// against without a real cluster. It serves three independent instances
// (home, orders, utility) on three ports, each with its own slice of a
// 99-application fleet, so MazeCD's multi-instance config has something real
// to point at. Every response is generated from the in-memory fixtures in
// fixtures.go; nothing here reaches the network or a filesystem at runtime,
// and any bearer token is accepted.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// ---- JSON shapes -----------------------------------------------------
//
// These mirror only the fields MazeCD's Go client and web UI actually read
// (see internal/argocd/apps.go and web/src/api/types.ts), not ArgoCD's full
// Application CRD.

type metadata struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type destination struct {
	Server    string `json:"server"`
	Namespace string `json:"namespace"`
}

// source mirrors ArgoCD's spec.source: where the manifests come from. The
// web UI's detail screen labels all three, and the repository URL is
// deliberately long enough in the fixtures to exercise its truncation.
type source struct {
	RepoURL        string `json:"repoURL"`
	Path           string `json:"path"`
	TargetRevision string `json:"targetRevision"`
}

type spec struct {
	Project     string      `json:"project"`
	Source      source      `json:"source"`
	Destination destination `json:"destination"`
	SyncPolicy  *syncPolicy `json:"syncPolicy,omitempty"`
}

// syncPolicy mirrors ArgoCD's spec.syncPolicy just enough for the automated
// case: present means auto-sync, absent means manual. prune/selfHeal are
// filled with realistic defaults but MazeCD's backend ignores them -- only
// Automated's presence is read.
type syncPolicy struct {
	Automated *automatedSync `json:"automated,omitempty"`
}

type automatedSync struct {
	Prune    bool `json:"prune"`
	SelfHeal bool `json:"selfHeal"`
}

type health struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type syncStatus struct {
	Status   string `json:"status"`
	Revision string `json:"revision,omitempty"`
}

// operationState mirrors status.operationState. Phase and finishedAt are all
// the fixture used to need; the rest is what a sync leaves behind (see
// operations.go) so a client can show what was run and what it did.
type operationState struct {
	Operation  *operationSpec       `json:"operation,omitempty"`
	Phase      string               `json:"phase"`
	Message    string               `json:"message,omitempty"`
	SyncResult *syncOperationResult `json:"syncResult,omitempty"`
	StartedAt  string               `json:"startedAt,omitempty"`
	FinishedAt string               `json:"finishedAt,omitempty"`
}

// listResourceStatus mirrors one entry of ArgoCD's status.resources[]: enough
// to drive MazeCD's total/unhealthy resource counts.
type listResourceStatus struct {
	Group     string  `json:"group,omitempty"`
	Kind      string  `json:"kind"`
	Name      string  `json:"name"`
	Namespace string  `json:"namespace"`
	Status    string  `json:"status,omitempty"`
	Health    *health `json:"health,omitempty"`
}

type status struct {
	Health         health               `json:"health"`
	Sync           syncStatus           `json:"sync"`
	OperationState *operationState      `json:"operationState,omitempty"`
	Resources      []listResourceStatus `json:"resources"`
}

type application struct {
	Metadata metadata `json:"metadata"`
	Spec     spec     `json:"spec"`
	Status   status   `json:"status"`
}

func toJSON(a *App) application {
	app := application{
		Metadata: metadata{Name: a.Name, Namespace: "argocd"},
		Spec: spec{
			Project:     a.Project,
			Source:      source{RepoURL: a.RepoURL, Path: "apps/" + a.Name, TargetRevision: a.TargetRevision},
			Destination: destination{Server: "https://kubernetes.default.svc", Namespace: a.Name},
		},
	}
	if a.AutoSync {
		app.Spec.SyncPolicy = &syncPolicy{Automated: &automatedSync{Prune: true, SelfHeal: true}}
	}
	app.Status = status{
		Health:    health{Status: a.Health, Message: a.HealthMessage},
		Sync:      syncStatus{Status: a.Sync, Revision: a.Revision},
		Resources: resourceStatuses(a),
	}
	if a.Op != nil {
		op := *a.Op // the handlers own a.Op; the response gets a copy
		app.Status.OperationState = &op
	} else {
		app.Status.OperationState = &operationState{
			Phase:      a.OperationPhase,
			FinishedAt: a.OperationFinishedAt.Format(time.RFC3339),
		}
	}
	return app
}

// resourceStatuses fakes status.resources[] for the applications list.
//
// The first entries are the application's real *managed* resources -- the
// parentless nodes of its resource tree -- so the detail screen can join the
// two and show a per-resource sync mark on exactly the resources ArgoCD
// reports one for. A Pod under a ReplicaSet has no sync status of its own and
// must stay absent, which is what makes the "?" on those rows honest rather
// than a gap in the fixture.
//
// The remainder is padding up to a.ResourceCount, which is what gives the
// list its varied "N res" figures. The first a.UnhealthyResources of the
// whole set carry the app's own health status and message, so a Degraded
// row's unhealthy count has a believable cause; a third of the rest report no
// health field at all -- many resource kinds genuinely never do -- and the
// remainder are explicitly Healthy.
func resourceStatuses(a *App) []listResourceStatus {
	kinds := []string{
		"Deployment", "ReplicaSet", "Pod", "Service", "ConfigMap", "Secret",
		"ServiceAccount", "Role", "RoleBinding", "PersistentVolumeClaim",
		"CronJob", "Ingress",
	}

	var out []listResourceStatus
	for _, n := range resourceTree(a) {
		if len(n.ParentRefs) > 0 {
			continue
		}
		out = append(out, listResourceStatus{
			Group: n.Group, Kind: n.Kind, Name: n.Name, Namespace: n.Namespace,
			Status: a.Sync,
		})
	}
	for i := len(out); i < a.ResourceCount; i++ {
		out = append(out, listResourceStatus{
			Kind: kinds[i%len(kinds)], Name: fmt.Sprintf("%s-%d", a.Name, i),
			Namespace: a.Name, Status: a.Sync,
		})
	}

	rest := len(out) - a.UnhealthyResources
	noHealth := rest / 3
	for i := range out {
		switch {
		case i < a.UnhealthyResources:
			out[i].Health = &health{Status: a.Health, Message: a.HealthMessage}
		case i < a.UnhealthyResources+noHealth:
			// no health field: many resource kinds never report one.
		default:
			out[i].Health = &health{Status: "Healthy"}
		}
	}
	return out
}

type resourceRef struct {
	Group     string `json:"group"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type resourceNode struct {
	resourceRef
	Version    string        `json:"version"`
	ParentRefs []resourceRef `json:"parentRefs,omitempty"`
	Health     *health       `json:"health,omitempty"`
}

// resourceTree builds a genuinely nested tree for one application:
// Deployment -> ReplicaSet -> 2 Pods, CronJob -> Job -> Pod, plus a Service
// and an ExternalSecret. When the app itself is Degraded, the workload
// carries the same health and message all the way down to one pod, so the
// detail screen's tree shows exactly what made the app red.
func resourceTree(a *App) []resourceNode {
	ns := a.Name
	// Whatever the application says about itself, its workload says too --
	// including the Progressing the demo cycler flips it into, which is what
	// makes the resource-tree watch observably live.
	deployHealth := &health{Status: "Healthy"}
	if a.Health != "Healthy" && a.Health != "" {
		deployHealth = &health{Status: a.Health, Message: a.HealthMessage}
	}

	deploy := resourceRef{Group: "apps", Kind: "Deployment", Name: a.Name, Namespace: ns}
	rs := resourceRef{Group: "apps", Kind: "ReplicaSet", Name: a.Name + "-7d9f8b6b8", Namespace: ns}
	cron := resourceRef{Group: "batch", Kind: "CronJob", Name: a.Name + "-backup", Namespace: ns}
	job := resourceRef{Group: "batch", Kind: "Job", Name: a.Name + "-backup-28912345", Namespace: ns}

	nodes := []resourceNode{
		{resourceRef: deploy, Version: "v1", Health: deployHealth},
		{resourceRef: rs, Version: "v1", ParentRefs: []resourceRef{deploy}, Health: &health{Status: "Healthy"}},
		{
			resourceRef: resourceRef{Kind: "Pod", Name: a.Name + "-7d9f8b6b8-x2k9v", Namespace: ns},
			Version:     "v1", ParentRefs: []resourceRef{rs}, Health: deployHealth,
		},
		{
			resourceRef: resourceRef{Kind: "Pod", Name: a.Name + "-7d9f8b6b8-x2k9w", Namespace: ns},
			Version:     "v1", ParentRefs: []resourceRef{rs}, Health: &health{Status: "Healthy"},
		},
		{resourceRef: cron, Version: "v1", Health: &health{Status: "Healthy"}},
		{resourceRef: job, Version: "v1", ParentRefs: []resourceRef{cron}, Health: &health{Status: "Healthy"}},
		{
			resourceRef: resourceRef{Kind: "Pod", Name: a.Name + "-backup-28912345-4mzq2", Namespace: ns},
			Version:     "v1", ParentRefs: []resourceRef{job}, Health: &health{Status: "Healthy"},
		},
		{
			resourceRef: resourceRef{Kind: "Service", Name: a.Name, Namespace: ns},
			Version:     "v1",
		},
		{
			resourceRef: resourceRef{Group: "external-secrets.io", Kind: "ExternalSecret", Name: a.Name + "-secrets", Namespace: ns},
			Version:     "v1beta1", Health: &health{Status: "Healthy"},
		},
	}
	return nodes
}

type involvedObject struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
}

type appEvent struct {
	Reason         string         `json:"reason"`
	Message        string         `json:"message"`
	Type           string         `json:"type"`
	LastTimestamp  string         `json:"lastTimestamp"`
	InvolvedObject involvedObject `json:"involvedObject"`
}

func events(a *App) []appEvent {
	now := time.Now().UTC()
	ts := func(agoMin int) string { return now.Add(-time.Duration(agoMin) * time.Minute).Format(time.RFC3339) }
	evs := []appEvent{
		{Reason: "Scheduled", Message: fmt.Sprintf("Successfully assigned %s/%s to node-3", a.Name, a.Name),
			Type: "Normal", LastTimestamp: ts(42), InvolvedObject: involvedObject{Kind: "Pod", Name: a.Name + "-7d9f8b6b8-x2k9v"}},
		{Reason: "Pulled", Message: "Container image already present on machine",
			Type: "Normal", LastTimestamp: ts(41), InvolvedObject: involvedObject{Kind: "Pod", Name: a.Name + "-7d9f8b6b8-x2k9v"}},
		{Reason: "Started", Message: "Started container " + a.Name,
			Type: "Normal", LastTimestamp: ts(41), InvolvedObject: involvedObject{Kind: "Pod", Name: a.Name + "-7d9f8b6b8-x2k9v"}},
	}
	if a.Health == "Degraded" {
		evs = append(evs, appEvent{
			Reason: "Unhealthy", Message: a.HealthMessage, Type: "Warning", LastTimestamp: ts(1),
			InvolvedObject: involvedObject{Kind: "Pod", Name: a.Name + "-7d9f8b6b8-x2k9v"},
		})
	}
	return evs
}

func logLines(a *App) []string {
	lines := []string{
		fmt.Sprintf("time=%q level=INFO msg=\"starting %s\" version=1.4.2", time.Now().UTC().Format(time.RFC3339), a.Name),
		"time=" + time.Now().UTC().Format(time.RFC3339) + " level=INFO msg=\"listening\" addr=:8080",
		"GET /healthz 200 1ms",
		"GET /healthz 200 1ms",
		"GET /metrics 200 3ms",
	}
	if a.Health == "Degraded" {
		lines = append(lines,
			"level=ERROR msg=\""+a.HealthMessage+"\"",
			"level=ERROR msg=\""+a.HealthMessage+"\"",
			"level=WARN msg=\"restarting container\" attempt=3",
		)
	}
	lines = append(lines, "GET /healthz 200 1ms", "GET /healthz 200 1ms")
	return lines
}

// ---- watch / stream ----------------------------------------------------

// change is one application's new state, rendered for both watch endpoints
// at the moment it changed. Both projections are computed by the cycler, in
// the cycler's goroutine, so a subscriber never reads the mutable *App.
type change struct {
	name string
	app  application
	tree []resourceNode
}

// broadcaster fans one instance's application changes out to every open
// watch connection -- /api/v1/stream/applications and the per-application
// /api/v1/stream/applications/{name}/resource-tree alike. This is the whole
// mechanism real ArgoCD's watch uses too: an informer publishes, subscribers
// get a copy.
type broadcaster struct {
	mu   sync.Mutex
	subs map[chan change]struct{}
}

func newBroadcaster() *broadcaster { return &broadcaster{subs: map[chan change]struct{}{}} }

func (b *broadcaster) subscribe() chan change {
	ch := make(chan change, 8)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *broadcaster) unsubscribe(ch chan change) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	close(ch)
}

func (b *broadcaster) publish(c change) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- c:
		default: // a slow subscriber drops the tick rather than blocking the cycler
		}
	}
}

// instance is one fixture ArgoCD: its applications, its watchers, and the
// single goroutine allowed to write to those applications. Handlers that
// change an application (sync, resource actions) send the change down ops
// rather than touching *App themselves, which is what keeps the "computed in
// the cycler's goroutine" promise above true now that the fixture is no
// longer read-only.
type instance struct {
	apps []*App
	bc   *broadcaster
	ops  chan func()
}

func newInstance(apps []*App) *instance {
	return &instance{apps: apps, bc: newBroadcaster(), ops: make(chan func(), 16)}
}

// snapshot runs fn in that one goroutine and hands back what it returned, so
// a handler never reads an *App mid-write. Every response built from mutable
// fixture state goes through here; the streams use it for the state they send
// on connect, and take everything after that from the broadcaster, which is
// fed from the same goroutine.
func snapshot[T any](i *instance, fn func() T) T {
	done := make(chan T, 1)
	i.ops <- func() { done <- fn() }
	return <-done
}

// cycle flips this instance's demo app between Healthy and Progressing every
// 5s, forever, so a developer watching the stream (or just polling
// /applications) sees a real state change without touching a real cluster.
// Every instance has one, which is what makes "one instance's stream died,
// the other two are still updating" a thing the harness can actually observe.
// The same goroutine applies whatever the write handlers queue on ops.
func (i *instance) cycle(name string) {
	demo := byName(i.apps, demoApps[name])
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case op := <-i.ops:
			op()
		case <-tick.C:
			if demo == nil {
				continue
			}
			// A demo app that somebody synced keeps its operation: the
			// cycler owns the health flip, and status.operationState only for
			// as long as nothing else has written one. It used to clear it
			// unconditionally every five seconds, which wiped the receipt of
			// a sync -- and of a dry run, whose receipt is the only thing it
			// produces -- seconds after it was asked for.
			if demo.Health == "Healthy" {
				demo.Health, demo.OperationPhase = "Progressing", "Running"
			} else {
				demo.Health, demo.OperationPhase = "Healthy", ""
			}
			i.bc.publish(change{name: demo.Name, app: toJSON(demo), tree: resourceTree(demo)})
		}
	}
}

// ---- HTTP ---------------------------------------------------------------

func mustEncode(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func byName(apps []*App, name string) *App {
	for _, a := range apps {
		if a.Name == name {
			return a
		}
	}
	return nil
}

func newInstanceMux(inst *instance) *http.ServeMux {
	apps, bc := inst.apps, inst.bc
	mux := http.NewServeMux()
	registerOperations(mux, inst)

	mux.HandleFunc("GET /api/v1/session/userinfo", func(w http.ResponseWriter, r *http.Request) {
		mustEncode(w, map[string]bool{"loggedIn": true})
	})

	mux.HandleFunc("GET /api/v1/applications", func(w http.ResponseWriter, r *http.Request) {
		items := snapshot(inst, func() []application {
			out := make([]application, len(apps))
			for i, a := range apps {
				out[i] = toJSON(a)
			}
			return out
		})
		mustEncode(w, map[string]any{"items": items})
	})

	mux.HandleFunc("GET /api/v1/applications/{name}", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		mustEncode(w, snapshot(inst, func() application { return toJSON(a) }))
	})

	mux.HandleFunc("GET /api/v1/applications/{name}/resource-tree", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		mustEncode(w, map[string]any{"nodes": snapshot(inst, func() []resourceNode { return resourceTree(a) })})
	})

	mux.HandleFunc("GET /api/v1/applications/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		mustEncode(w, map[string]any{"items": snapshot(inst, func() []appEvent { return events(a) })})
	})

	// /logs streams newline-delimited JSON the way ArgoCD does:
	// {"result":{"content":"..."}}\n per line, flushed as it is written.
	mux.HandleFunc("GET /api/v1/applications/{name}/logs", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		flusher, _ := w.(http.Flusher)
		enc := json.NewEncoder(w)
		for _, line := range snapshot(inst, func() []string { return logLines(a) }) {
			_ = enc.Encode(map[string]any{"result": map[string]string{"content": line}})
			if flusher != nil {
				flusher.Flush()
			}
			time.Sleep(20 * time.Millisecond)
		}
	})

	// /stream/applications: see the investigation note in README/report --
	// this mirrors ArgoCD's own watch endpoint, a chunked response of
	// {"result":{"type":"ADDED"|"MODIFIED","application":{...}}} lines. On
	// connect every current application is sent once as ADDED (the initial
	// list a real watch also replays), then further changes arrive as
	// MODIFIED whenever the demo cycler flips a state.
	mux.HandleFunc("GET /api/v1/stream/applications", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		enc := json.NewEncoder(w)
		for _, app := range snapshot(inst, func() []application {
			out := make([]application, len(apps))
			for i, a := range apps {
				out[i] = toJSON(a)
			}
			return out
		}) {
			_ = enc.Encode(map[string]any{"result": map[string]any{"type": "ADDED", "application": app}})
		}
		flusher.Flush()

		ch := bc.subscribe()
		defer bc.unsubscribe(ch)
		for {
			select {
			case c, ok := <-ch:
				if !ok {
					return
				}
				_ = enc.Encode(map[string]any{"result": map[string]any{"type": "MODIFIED", "application": c.app}})
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})

	// /stream/applications/{name}/resource-tree is ArgoCD's WatchResourceTree
	// (same proto, same gateway annotation as Watch above). It sends the whole
	// tree, not a delta: the current one on connect, then a fresh one every
	// time this application changes.
	mux.HandleFunc("GET /api/v1/stream/applications/{name}/resource-tree", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}
		enc := json.NewEncoder(w)
		_ = enc.Encode(map[string]any{"result": map[string]any{"nodes": snapshot(inst, func() []resourceNode { return resourceTree(a) })}})
		flusher.Flush()

		ch := bc.subscribe()
		defer bc.unsubscribe(ch)
		for {
			select {
			case c, ok := <-ch:
				if !ok {
					return
				}
				if c.name != a.Name {
					continue
				}
				_ = enc.Encode(map[string]any{"result": map[string]any{"nodes": c.tree}})
				flusher.Flush()
			case <-r.Context().Done():
				return
			}
		}
	})

	return mux
}

func main() {
	homePort := flag.Int("home-port", 9081, "port for the 'home' instance")
	ordersPort := flag.Int("orders-port", 9082, "port for the 'orders' instance")
	utilityPort := flag.Int("utility-port", 9083, "port for the 'utility' instance")
	flag.Parse()

	apps := buildApps()
	grouped := byInstance(apps)

	ports := map[string]int{"home": *homePort, "orders": *ordersPort, "utility": *utilityPort}
	var wg sync.WaitGroup
	for _, name := range []string{"home", "orders", "utility"} {
		name, port := name, ports[name]
		inst := newInstance(grouped[name])
		go inst.cycle(name)

		wg.Add(1)
		go func() {
			defer wg.Done()
			addr := fmt.Sprintf("127.0.0.1:%d", port)
			log.Printf("stubargo: instance %-8s %d apps  http://%s", name, len(inst.apps), addr)
			if err := http.ListenAndServe(addr, newInstanceMux(inst)); err != nil {
				log.Fatalf("stubargo: instance %s: %v", name, err)
			}
		}()
	}
	log.Printf("stubargo: %d applications across %d instances (accepts any bearer token)", len(apps), len(ports))
	wg.Wait()
}
