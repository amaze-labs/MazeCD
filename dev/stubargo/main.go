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

type spec struct {
	Project     string      `json:"project"`
	Destination destination `json:"destination"`
}

type health struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

type syncStatus struct {
	Status   string `json:"status"`
	Revision string `json:"revision,omitempty"`
}

type operationState struct {
	Phase string `json:"phase"`
}

type status struct {
	Health         health          `json:"health"`
	Sync           syncStatus      `json:"sync"`
	OperationState *operationState `json:"operationState,omitempty"`
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
			Destination: destination{Server: "https://kubernetes.default.svc", Namespace: a.Name},
		},
		Status: status{
			Health: health{Status: a.Health, Message: a.HealthMessage},
			Sync:   syncStatus{Status: a.Sync, Revision: a.Revision},
		},
	}
	if a.OperationPhase != "" {
		app.Status.OperationState = &operationState{Phase: a.OperationPhase}
	}
	return app
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
	deployHealth := &health{Status: "Healthy"}
	if a.Health == "Degraded" {
		deployHealth = &health{Status: "Degraded", Message: a.HealthMessage}
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

// broadcaster fans one instance's application changes out to every open
// /api/v1/stream/applications connection. This is the whole mechanism real
// ArgoCD's watch uses too: an informer publishes, subscribers get a copy.
type broadcaster struct {
	mu   sync.Mutex
	subs map[chan application]struct{}
}

func newBroadcaster() *broadcaster { return &broadcaster{subs: map[chan application]struct{}{}} }

func (b *broadcaster) subscribe() chan application {
	ch := make(chan application, 8)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *broadcaster) unsubscribe(ch chan application) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	close(ch)
}

func (b *broadcaster) publish(a application) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- a:
		default: // a slow subscriber drops the tick rather than blocking the cycler
		}
	}
}

// cycle flips the instance's demo app between Healthy and Progressing every
// 5s, forever, so a developer watching the stream (or just polling
// /applications) sees a real state change without touching a real cluster.
func cycle(apps []*App, bc *broadcaster) {
	var demo *App
	for _, a := range apps {
		if a.Name == demoApp {
			demo = a
			break
		}
	}
	if demo == nil {
		return
	}
	for {
		time.Sleep(5 * time.Second)
		if demo.Health == "Healthy" {
			demo.Health, demo.OperationPhase = "Progressing", "Running"
		} else {
			demo.Health, demo.OperationPhase = "Healthy", ""
		}
		bc.publish(toJSON(demo))
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

func newInstanceMux(apps []*App, bc *broadcaster) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/v1/session/userinfo", func(w http.ResponseWriter, r *http.Request) {
		mustEncode(w, map[string]bool{"loggedIn": true})
	})

	mux.HandleFunc("GET /api/v1/applications", func(w http.ResponseWriter, r *http.Request) {
		items := make([]application, len(apps))
		for i, a := range apps {
			items[i] = toJSON(a)
		}
		mustEncode(w, map[string]any{"items": items})
	})

	mux.HandleFunc("GET /api/v1/applications/{name}", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		mustEncode(w, toJSON(a))
	})

	mux.HandleFunc("GET /api/v1/applications/{name}/resource-tree", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		mustEncode(w, map[string]any{"nodes": resourceTree(a)})
	})

	mux.HandleFunc("GET /api/v1/applications/{name}/events", func(w http.ResponseWriter, r *http.Request) {
		a := byName(apps, r.PathValue("name"))
		if a == nil {
			http.NotFound(w, r)
			return
		}
		mustEncode(w, map[string]any{"items": events(a)})
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
		for _, line := range logLines(a) {
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
		for _, a := range apps {
			_ = enc.Encode(map[string]any{"result": map[string]any{"type": "ADDED", "application": toJSON(a)}})
		}
		flusher.Flush()

		ch := bc.subscribe()
		defer bc.unsubscribe(ch)
		for {
			select {
			case app, ok := <-ch:
				if !ok {
					return
				}
				_ = enc.Encode(map[string]any{"result": map[string]any{"type": "MODIFIED", "application": app}})
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
		instApps := grouped[name]
		bc := newBroadcaster()
		go cycle(instApps, bc)

		wg.Add(1)
		go func() {
			defer wg.Done()
			addr := fmt.Sprintf("127.0.0.1:%d", port)
			log.Printf("stubargo: instance %-8s %d apps  http://%s", name, len(instApps), addr)
			if err := http.ListenAndServe(addr, newInstanceMux(instApps, bc)); err != nil {
				log.Fatalf("stubargo: instance %s: %v", name, err)
			}
		}()
	}
	log.Printf("stubargo: %d applications across %d instances (accepts any bearer token)", len(apps), len(ports))
	wg.Wait()
}
