package main

// Sync, diff, manifests and resource actions -- the four write-ish endpoints
// the fixture serves on top of the read-only ones in main.go.
//
// Every shape here was checked against ArgoCD's own definitions rather than
// recalled:
//
//	server/application/application.proto   ApplicationSyncRequest (POST
//	  /api/v1/applications/{name}/sync, body "*"), ManagedResourcesResponse
//	  (GET .../{applicationName}/managed-resources), ApplicationManifestQuery
//	  (GET .../{name}/manifests), ResourceActionsListResponse (GET
//	  .../{name}/resource/actions) and ResourceActionRunRequest{,V2} (POST
//	  .../resource/actions, body "action" -- a bare JSON string -- and POST
//	  .../resource/actions/v2, body "*").
//	pkg/apis/.../v1alpha1/generated.proto  ResourceDiff, ResourceAction,
//	  SyncOperationResource, SyncStrategy, Operation/OperationState.
//	reposerver/repository/repository.proto ManifestResponse.
//
// The state fields of a ResourceDiff are JSON *strings* on the wire (the UI
// JSON.parses them), and a side that does not exist is the string "null",
// which is what json.Marshal of a nil object produces upstream.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ---- sync --------------------------------------------------------------

type syncOperationResource struct {
	Group     string `json:"group,omitempty"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

type syncStrategyApply struct {
	Force bool `json:"force,omitempty"`
}

type syncStrategy struct {
	Apply *syncStrategyApply `json:"apply,omitempty"`
	Hook  *syncStrategyApply `json:"hook,omitempty"`
}

// syncRequest is ArgoCD's ApplicationSyncRequest. syncOptions is the wrapper
// object {"items":["Validate=false",...]} on the request; on the stored
// operation it is a bare string list, which is the asymmetry in ArgoCD's own
// types (SyncOptions the message vs SyncOptions the []string) and not a typo.
type syncRequest struct {
	Name        string                  `json:"name"`
	Revision    string                  `json:"revision,omitempty"`
	DryRun      bool                    `json:"dryRun,omitempty"`
	Prune       bool                    `json:"prune,omitempty"`
	Strategy    *syncStrategy           `json:"strategy,omitempty"`
	Resources   []syncOperationResource `json:"resources,omitempty"`
	Manifests   []string                `json:"manifests,omitempty"`
	SyncOptions *struct {
		Items []string `json:"items,omitempty"`
	} `json:"syncOptions,omitempty"`
	AppNamespace string `json:"appNamespace,omitempty"`
	Project      string `json:"project,omitempty"`
}

func (r syncRequest) options() []string {
	if r.SyncOptions == nil {
		return nil
	}
	return r.SyncOptions.Items
}

// syncOperationSpec is status.operationState.operation.sync: what was asked
// for, echoed back so the UI can say *how* this sync was run.
type syncOperationSpec struct {
	Revision     string                  `json:"revision,omitempty"`
	Prune        bool                    `json:"prune,omitempty"`
	DryRun       bool                    `json:"dryRun,omitempty"`
	SyncStrategy *syncStrategy           `json:"syncStrategy,omitempty"`
	Resources    []syncOperationResource `json:"resources,omitempty"`
	SyncOptions  []string                `json:"syncOptions,omitempty"`
}

type operationSpec struct {
	Sync        *syncOperationSpec `json:"sync,omitempty"`
	InitiatedBy struct {
		Username string `json:"username,omitempty"`
	} `json:"initiatedBy"`
}

type resourceResult struct {
	Group     string `json:"group,omitempty"`
	Version   string `json:"version"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Status    string `json:"status,omitempty"`
	Message   string `json:"message,omitempty"`
	SyncPhase string `json:"syncPhase,omitempty"`
}

type syncOperationResult struct {
	Revision  string           `json:"revision"`
	Resources []resourceResult `json:"resources,omitempty"`
}

// syncDuration is how long a fixture sync stays Running. Long enough that the
// operation is genuinely observable in the UI (and on a screenshot), short
// enough that a harness can wait it out. A var so the tests can shorten it.
var syncDuration = 2 * time.Second

// startSync moves the application into a running operation. It runs in the
// cycler's goroutine, the only writer of *App.
func startSync(a *App, req syncRequest) {
	if a.Health == "Healthy" {
		a.Health = "Progressing"
	}
	a.OperationPhase = "Running"
	a.Op = &operationState{
		Operation: &operationSpec{Sync: &syncOperationSpec{
			Revision: req.Revision, Prune: req.Prune, DryRun: req.DryRun,
			SyncStrategy: req.Strategy, Resources: req.Resources, SyncOptions: req.options(),
		}},
		Phase:     "Running",
		Message:   "waiting for healthy state of " + a.Name,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// finishSync completes it. A selective sync (resources named in the request)
// deliberately leaves the application OutOfSync: only part of it was synced,
// which is exactly what ArgoCD reports.
func finishSync(a *App, req syncRequest) {
	if a.Health == "Progressing" {
		a.Health = "Healthy"
	}
	if req.Revision != "" {
		a.Revision = req.Revision
	}
	if len(req.Resources) == 0 {
		a.Sync = "Synced"
	}
	a.OperationPhase = "Succeeded"
	a.OperationFinishedAt = time.Now().UTC()
	op := a.Op
	if op == nil {
		op = &operationState{}
	}
	op.Phase = "Succeeded"
	op.Message = "successfully synced (all tasks run)"
	op.FinishedAt = a.OperationFinishedAt.Format(time.RFC3339)
	op.SyncResult = &syncOperationResult{Revision: a.Revision, Resources: syncedResources(a, req)}
	a.Op = op
}

// syncedResources is the per-resource receipt of a sync: every managed
// resource the request covered, with what happened to it.
func syncedResources(a *App, req syncRequest) []resourceResult {
	selected := func(d resourceDiff) bool {
		if len(req.Resources) == 0 {
			return true
		}
		for _, r := range req.Resources {
			if r.Kind == d.Kind && r.Name == d.Name {
				return true
			}
		}
		return false
	}
	var out []resourceResult
	for _, d := range managedResources(a) {
		if !selected(d) {
			continue
		}
		ref := strings.ToLower(d.Kind) + " " + d.Namespace + "/" + d.Name
		res := resourceResult{
			Group: d.Group, Version: "v1", Kind: d.Kind, Namespace: d.Namespace, Name: d.Name,
			Status: "Synced", SyncPhase: "Sync", Message: ref + " unchanged",
		}
		switch {
		case d.LiveState == absent:
			res.Message = ref + " created"
		case d.TargetState == absent:
			// Nothing is deleted unless the request asked for it, which is
			// the one place a sync request's prune flag is observable.
			res.Status, res.Message = "PruneSkipped", "ignored (requires pruning)"
			if req.Prune {
				res.Status, res.Message = "Pruned", ref+" pruned"
			}
		case d.Modified:
			res.Message = ref + " configured"
		}
		out = append(out, res)
	}
	return out
}

// dryRunState is the operation a dry run *would* have produced. It is built
// for the response only and never stored: a dry run must leave the fixture
// exactly as it found it.
func dryRunState(a *App, req syncRequest) *operationState {
	now := time.Now().UTC().Format(time.RFC3339)
	return &operationState{
		Operation: &operationSpec{Sync: &syncOperationSpec{
			Revision: req.Revision, Prune: req.Prune, DryRun: true,
			SyncStrategy: req.Strategy, Resources: req.Resources, SyncOptions: req.options(),
		}},
		Phase:      "Succeeded",
		Message:    "successfully synced (dry run)",
		StartedAt:  now,
		FinishedAt: now,
		SyncResult: &syncOperationResult{Revision: a.Revision, Resources: syncedResources(a, req)},
	}
}

// ---- managed resources (the diff) --------------------------------------

// absent is the state of a resource that exists on only one side. ArgoCD
// marshals the missing object with encoding/json, so the wire value is the
// four characters of a JSON null, not an empty string.
const absent = "null"

type resourceDiff struct {
	Group               string `json:"group,omitempty"`
	Kind                string `json:"kind"`
	Namespace           string `json:"namespace"`
	Name                string `json:"name"`
	TargetState         string `json:"targetState"`
	LiveState           string `json:"liveState"`
	NormalizedLiveState string `json:"normalizedLiveState"`
	PredictedLiveState  string `json:"predictedLiveState"`
	Hook                bool   `json:"hook,omitempty"`
	Modified            bool   `json:"modified,omitempty"`
	ResourceVersion     string `json:"resourceVersion,omitempty"`
}

type obj = map[string]any

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err) // fixtures are static: a failure here is a bug, not input
	}
	return string(b)
}

func meta(a *App, name string, labels obj) obj {
	l := obj{"app.kubernetes.io/name": a.Name, "app.kubernetes.io/instance": a.Name}
	for k, v := range labels {
		l[k] = v
	}
	return obj{"name": name, "namespace": a.Name, "labels": l}
}

func deploymentObj(a *App, tag string, replicas int) obj {
	return obj{
		"apiVersion": "apps/v1", "kind": "Deployment", "metadata": meta(a, a.Name, nil),
		"spec": obj{
			"replicas": replicas,
			"selector": obj{"matchLabels": obj{"app.kubernetes.io/name": a.Name}},
			"template": obj{
				"metadata": obj{"labels": obj{"app.kubernetes.io/name": a.Name}},
				"spec": obj{"containers": []any{obj{
					"name":      a.Name,
					"image":     "registry.internal/" + a.Name + ":" + tag,
					"ports":     []any{obj{"containerPort": 8080, "name": "http"}},
					"resources": obj{"requests": obj{"cpu": "100m", "memory": "128Mi"}},
				}}},
			},
		},
	}
}

func serviceObj(a *App, labels obj) obj {
	return obj{
		"apiVersion": "v1", "kind": "Service", "metadata": meta(a, a.Name, labels),
		"spec": obj{
			"type":     "ClusterIP",
			"selector": obj{"app.kubernetes.io/name": a.Name},
			"ports":    []any{obj{"name": "http", "port": 80, "targetPort": "http"}},
		},
	}
}

func configMapObj(a *App) obj {
	return obj{
		"apiVersion": "v1", "kind": "ConfigMap", "metadata": meta(a, a.Name+"-config", nil),
		"data": obj{"LOG_LEVEL": "info", "LISTEN_ADDR": ":8080"},
	}
}

func serviceAccountObj(a *App) obj {
	return obj{"apiVersion": "v1", "kind": "ServiceAccount", "metadata": meta(a, a.Name, nil)}
}

func cronJobObj(a *App) obj {
	return obj{
		"apiVersion": "batch/v1", "kind": "CronJob", "metadata": meta(a, a.Name+"-backup", nil),
		"spec": obj{
			"schedule":          "17 3 * * *",
			"concurrencyPolicy": "Forbid",
			"jobTemplate": obj{"spec": obj{"template": obj{"spec": obj{
				"restartPolicy": "OnFailure",
				"containers": []any{obj{
					"name": "backup", "image": "registry.internal/backup:2.1.0",
					"args": []any{"--source", a.Name},
				}},
			}}}},
		},
	}
}

// legacyConfigMapObj is the resource that exists in the cluster and nowhere
// in git -- somebody's kubectl apply, and the reason prune exists.
func legacyConfigMapObj(a *App) obj {
	return obj{
		"apiVersion": "v1", "kind": "ConfigMap", "metadata": meta(a, a.Name+"-legacy-config", nil),
		"data": obj{"LOG_LEVEL": "debug"},
	}
}

func diffOf(group, kind string, a *App, name string, target, live any) resourceDiff {
	d := resourceDiff{
		Group: group, Kind: kind, Namespace: a.Name, Name: name,
		TargetState: absent, LiveState: absent, ResourceVersion: "31337",
	}
	if target != nil {
		d.TargetState = mustJSON(target)
	}
	if live != nil {
		d.LiveState = mustJSON(live)
	}
	// normalizedLiveState is the live object after ArgoCD's normalizers, and
	// predictedLiveState what the live object would become. For a fixture
	// with no normalization to do, those are the two sides themselves --
	// which is what the UI's diff view actually reads.
	d.NormalizedLiveState, d.PredictedLiveState = d.LiveState, d.TargetState
	d.Modified = d.TargetState != d.LiveState
	return d
}

// managedResources is what a diff is computed from: every resource ArgoCD
// manages for this application, live state beside target state.
//
// An OutOfSync application drifts in five distinct ways at once, so the
// frontend's diff has one of each to render: a changed image tag, a changed
// replica count, an added label, a resource in git that the cluster does not
// have, and one in the cluster that git does not. Two resources match
// exactly, because a diff that only ever shows differences never has to
// decide what "no change" looks like. A Synced application shows the same
// resources with both sides identical.
func managedResources(a *App) []resourceDiff {
	drifted := a.Sync == "OutOfSync"

	target := deploymentObj(a, "1.4.2", 3)
	live := deploymentObj(a, "1.4.2", 3)
	targetSvc := serviceObj(a, obj{"app.kubernetes.io/part-of": a.Project})
	liveSvc := serviceObj(a, obj{"app.kubernetes.io/part-of": a.Project})
	if drifted {
		live = deploymentObj(a, "1.4.1", 2) // older image, fewer replicas
		liveSvc = serviceObj(a, nil)        // the part-of label is new in git
	}

	items := []resourceDiff{
		diffOf("apps", "Deployment", a, a.Name, target, live),
		diffOf("", "Service", a, a.Name, targetSvc, liveSvc),
		diffOf("", "ServiceAccount", a, a.Name, serviceAccountObj(a), serviceAccountObj(a)),
		diffOf("batch", "CronJob", a, a.Name+"-backup", cronJobObj(a), cronJobObj(a)),
	}
	if drifted {
		items = append(items,
			diffOf("", "ConfigMap", a, a.Name+"-config", configMapObj(a), nil),
			diffOf("", "ConfigMap", a, a.Name+"-legacy-config", nil, legacyConfigMapObj(a)),
		)
	} else {
		items = append(items, diffOf("", "ConfigMap", a, a.Name+"-config", configMapObj(a), configMapObj(a)))
	}
	return items
}

// ---- manifests ---------------------------------------------------------

type manifestResponse struct {
	Manifests  []string `json:"manifests"`
	Namespace  string   `json:"namespace"`
	Server     string   `json:"server"`
	Revision   string   `json:"revision"`
	SourceType string   `json:"sourceType"`
}

// manifests are the *desired* state, so they are the target side of the diff
// -- as JSON strings, which is what repo-server renders and what the UI
// converts to YAML for display. The live-only resource has no manifest by
// definition.
func manifests(a *App, revision string) manifestResponse {
	if revision == "" {
		revision = a.Revision
	}
	out := []string{}
	for _, d := range managedResources(a) {
		if d.TargetState != absent {
			out = append(out, d.TargetState)
		}
	}
	return manifestResponse{
		Manifests: out, Namespace: a.Name, Server: "https://kubernetes.default.svc",
		Revision: revision, SourceType: "Directory",
	}
}

// ---- resource actions --------------------------------------------------

type resourceAction struct {
	Name     string `json:"name"`
	Disabled bool   `json:"disabled,omitempty"`
}

// actionsFor is the honest part of this endpoint: actions are kind-dependent
// and most kinds have none at all. The sets mirror ArgoCD's shipped
// resource_customizations -- workloads restart/pause/resume, a CronJob makes
// a Job now, a Rollout drives its own rollout, an ExternalSecret refreshes --
// and `disabled` marks the ones that exist but cannot run in this state
// (nothing is paused here, so nothing can be resumed).
func actionsFor(group, kind string) []resourceAction {
	switch group + "/" + kind {
	case "apps/Deployment", "apps/StatefulSet", "apps/DaemonSet":
		return []resourceAction{{Name: "restart"}, {Name: "pause"}, {Name: "resume", Disabled: true}}
	case "argoproj.io/Rollout":
		return []resourceAction{{Name: "pause"}, {Name: "resume", Disabled: true}, {Name: "promote-full"}}
	case "batch/CronJob":
		return []resourceAction{{Name: "create-job"}, {Name: "suspend"}, {Name: "resume", Disabled: true}}
	case "external-secrets.io/ExternalSecret":
		return []resourceAction{{Name: "refresh"}}
	}
	return []resourceAction{}
}

// runAction is what an action does to the fixture: nudges the application
// into Progressing for a moment, the way a restart or a promote visibly
// would, so the frontend has something to observe after the button.
func runAction(a *App) { a.Health = "Progressing" }

// ---- handlers ----------------------------------------------------------

// mutate runs fn in the cycler's goroutine -- the single writer of *App --
// and publishes the resulting state to every open watch. The returned
// application is the post-mutation snapshot, taken in that same goroutine, so
// a handler never reads a half-written App.
func mutate(inst *instance, a *App, fn func()) application {
	return snapshot(inst, func() application {
		fn()
		c := change{name: a.Name, app: toJSON(a), tree: resourceTree(a)}
		inst.bc.publish(c)
		return c.app
	})
}

func badRequest(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg, "code": 3, "message": msg})
}

// registerOperations adds sync, managed-resources, manifests and the resource
// actions to one instance's mux.
func registerOperations(mux *http.ServeMux, inst *instance) {
	app := func(w http.ResponseWriter, r *http.Request, key string) *App {
		a := byName(inst.apps, r.PathValue(key))
		if a == nil {
			http.NotFound(w, r)
		}
		return a
	}

	mux.HandleFunc("POST /api/v1/applications/{name}/sync", func(w http.ResponseWriter, r *http.Request) {
		a := app(w, r, "name")
		if a == nil {
			return
		}
		var req syncRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			badRequest(w, "invalid sync request: "+err.Error())
			return
		}
		if req.DryRun {
			// Nothing is mutated and nothing is published: the response is a
			// snapshot of the untouched application, carrying the operation
			// the dry run stood in for.
			mustEncode(w, snapshot(inst, func() application {
				out := toJSON(a)
				out.Status.OperationState = dryRunState(a, req)
				return out
			}))
			return
		}
		out := mutate(inst, a, func() { startSync(a, req) })
		time.AfterFunc(syncDuration, func() {
			inst.ops <- func() {
				finishSync(a, req)
				inst.bc.publish(change{name: a.Name, app: toJSON(a), tree: resourceTree(a)})
			}
		})
		mustEncode(w, out)
	})

	mux.HandleFunc("GET /api/v1/applications/{applicationName}/managed-resources", func(w http.ResponseWriter, r *http.Request) {
		a := app(w, r, "applicationName")
		if a == nil {
			return
		}
		mustEncode(w, map[string]any{"items": snapshot(inst, func() []resourceDiff { return managedResources(a) })})
	})

	mux.HandleFunc("GET /api/v1/applications/{name}/manifests", func(w http.ResponseWriter, r *http.Request) {
		a := app(w, r, "name")
		if a == nil {
			return
		}
		rev := r.URL.Query().Get("revision")
		mustEncode(w, snapshot(inst, func() manifestResponse { return manifests(a, rev) }))
	})

	mux.HandleFunc("GET /api/v1/applications/{name}/resource/actions", func(w http.ResponseWriter, r *http.Request) {
		a := app(w, r, "name")
		if a == nil {
			return
		}
		q := r.URL.Query()
		mustEncode(w, map[string]any{"actions": actionsFor(q.Get("group"), q.Get("kind"))})
	})

	// Both run endpoints: the deprecated one takes the action name as a bare
	// JSON string body (grpc-gateway's body:"action") with the resource in the
	// query string, the v2 one takes the whole request as an object.
	run := func(w http.ResponseWriter, r *http.Request) {
		a := app(w, r, "name")
		if a == nil {
			return
		}
		body, _ := io.ReadAll(r.Body)
		q := r.URL.Query()
		req := struct {
			Action string `json:"action"`
			Group  string `json:"group"`
			Kind   string `json:"kind"`
		}{Group: q.Get("group"), Kind: q.Get("kind")}
		trimmed := strings.TrimSpace(string(body))
		if strings.HasPrefix(trimmed, "\"") {
			if err := json.Unmarshal([]byte(trimmed), &req.Action); err != nil {
				badRequest(w, "invalid action: "+err.Error())
				return
			}
		} else if trimmed != "" {
			if err := json.Unmarshal([]byte(trimmed), &req); err != nil {
				badRequest(w, "invalid action request: "+err.Error())
				return
			}
			if v := q.Get("group"); v != "" {
				req.Group = v
			}
			if v := q.Get("kind"); v != "" {
				req.Kind = v
			}
		}
		for _, act := range actionsFor(req.Group, req.Kind) {
			if act.Name != req.Action {
				continue
			}
			if act.Disabled {
				badRequest(w, fmt.Sprintf("action %q is disabled for %s", req.Action, req.Kind))
				return
			}
			mutate(inst, a, func() { runAction(a) })
			mustEncode(w, map[string]any{}) // ApplicationResponse is empty
			return
		}
		badRequest(w, fmt.Sprintf("%s %q does not support action %q", req.Kind, r.URL.Query().Get("resourceName"), req.Action))
	}
	mux.HandleFunc("POST /api/v1/applications/{name}/resource/actions", run)
	mux.HandleFunc("POST /api/v1/applications/{name}/resource/actions/v2", run)
}
