package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// serve starts one fixture instance -- cycler goroutine and all -- in front of
// an httptest server, which is the only way the write endpoints can be
// exercised: they hand their mutation to that goroutine and wait for it.
func serve(t *testing.T, name string) (*httptest.Server, *instance) {
	t.Helper()
	inst := newInstance(byInstance(buildApps())[name])
	go inst.cycle("none") // no demo app for "none": nothing flips under the test
	srv := httptest.NewServer(newInstanceMux(inst))
	t.Cleanup(srv.Close)
	return srv, inst
}

func get(t *testing.T, srv *httptest.Server, path string, into any) {
	t.Helper()
	resp, err := http.Get(srv.URL + path)
	if err != nil {
		t.Fatalf("GET %s: %v", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET %s: status %d", path, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
		t.Fatalf("GET %s: decode: %v", path, err)
	}
}

func post(t *testing.T, srv *httptest.Server, path, body string, into any) int {
	t.Helper()
	resp, err := http.Post(srv.URL+path, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if into != nil && resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(raw, into); err != nil {
			t.Fatalf("POST %s: decode %s: %v", path, raw, err)
		}
	}
	return resp.StatusCode
}

// a full ArgoCD sync request: every field the real UI sends, including the
// syncOptions string items and both halves of the strategy.
const fullSyncBody = `{
  "name": "doc-archive",
  "revision": "HEAD",
  "prune": true,
  "dryRun": false,
  "strategy": {"apply": {"force": true}, "hook": {"force": false}},
  "syncOptions": {"items": [
    "Validate=false", "CreateNamespace=true", "PruneLast=true",
    "ApplyOutOfSyncOnly=true", "RespectIgnoreDifferences=true",
    "ServerSideApply=true", "PrunePropagationPolicy=foreground", "Replace=true"
  ]}
}`

func TestSyncRunsThenFinishes(t *testing.T) {
	// Long enough that the running operation is observable on a GET without
	// the test racing the timer that finishes it.
	syncDuration = 300 * time.Millisecond
	t.Cleanup(func() { syncDuration = 2 * time.Second })
	srv, _ := serve(t, "home")

	var out application
	if code := post(t, srv, "/api/v1/applications/doc-archive/sync", fullSyncBody, &out); code != 200 {
		t.Fatalf("sync: status %d", code)
	}
	// The response is the application as ArgoCD returns it: the operation has
	// been stored, and status.operationState cleared, so there is nothing here
	// to read a result from.
	if out.Status.OperationState != nil {
		t.Errorf("the sync response carries an operationState: %+v", out.Status.OperationState)
	}
	if out.Status.Sync.Status != "OutOfSync" {
		t.Errorf("sync status while the operation runs = %q, want OutOfSync", out.Status.Sync.Status)
	}

	// Everything about the operation is read from the application afterwards,
	// which is where a client has to read it too.
	var running application
	get(t, srv, "/api/v1/applications/doc-archive", &running)
	if running.Status.OperationState.Phase != "Running" {
		t.Errorf("phase right after sync = %q, want Running", running.Status.OperationState.Phase)
	}
	op := running.Status.OperationState.Operation
	if op == nil || op.Sync == nil || !op.Sync.Prune || len(op.Sync.SyncOptions) != 8 {
		t.Fatalf("the operation did not echo the request back: %+v", op)
	}
	if op.Sync.SyncStrategy == nil || op.Sync.SyncStrategy.Apply == nil || !op.Sync.SyncStrategy.Apply.Force {
		t.Errorf("apply strategy lost: %+v", op.Sync.SyncStrategy)
	}

	// A fresh value per poll: decoding into a reused struct keeps fields the
	// next response omits, which is exactly how an omitempty flag lies.
	var done application
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		done = application{}
		get(t, srv, "/api/v1/applications/doc-archive", &done)
		if done.Status.OperationState.Phase == "Succeeded" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if done.Status.OperationState.Phase != "Succeeded" {
		t.Fatalf("operation never finished: phase %q", done.Status.OperationState.Phase)
	}
	if done.Status.Sync.Status != "Synced" {
		t.Errorf("sync status after the operation = %q, want Synced", done.Status.Sync.Status)
	}
	if r := done.Status.OperationState.SyncResult; r == nil || len(r.Resources) == 0 {
		t.Fatal("finished sync has no syncResult")
	}
	if done.Status.OperationState.FinishedAt == "" {
		t.Error("finished sync has no finishedAt")
	}
	// The app is Synced now, so its diff must have stopped differing.
	var res struct{ Items []resourceDiff }
	get(t, srv, "/api/v1/applications/doc-archive/managed-resources", &res)
	for _, d := range res.Items {
		if d.Modified {
			t.Errorf("%s/%s still differs after a full sync", d.Kind, d.Name)
		}
	}
}

func TestSyncDryRunChangesNothing(t *testing.T) {
	syncDuration = 20 * time.Millisecond
	t.Cleanup(func() { syncDuration = 2 * time.Second })
	srv, _ := serve(t, "utility")

	// Everything here is read over HTTP: the instance's own goroutine is the
	// only thing allowed to touch an *App, and a dry run now writes an
	// operation from it like any other sync.
	var before application
	get(t, srv, "/api/v1/applications/cert-manager", &before)

	var out application
	if code := post(t, srv, "/api/v1/applications/cert-manager/sync",
		`{"name":"cert-manager","dryRun":true,"prune":true}`, &out); code != 200 {
		t.Fatalf("dry run: status %d", code)
	}
	// The response is ArgoCD's: an application whose status.operationState was
	// cleared by util/argo.SetAppOperation on the way out. A client that reads
	// a verdict off this reads a constant.
	if out.Status.OperationState != nil {
		t.Errorf("the sync response carries an operationState: %+v", out.Status.OperationState)
	}
	if out.Status.Sync.Status != "OutOfSync" {
		t.Errorf("dry run moved the sync status to %q", out.Status.Sync.Status)
	}

	// The verdict arrives afterwards, in status.operationState, which is the
	// only place it is ever reported -- and nothing else about the application
	// moves.
	time.Sleep(100 * time.Millisecond)
	var after application
	get(t, srv, "/api/v1/applications/cert-manager", &after)
	if after.Status.Sync != before.Status.Sync || after.Status.Health != before.Status.Health {
		t.Errorf("dry run mutated the application: %+v -> %+v", before.Status, after.Status)
	}
	op := after.Status.OperationState
	if op == nil || op.Phase != "Succeeded" || op.SyncResult == nil {
		t.Fatalf("no dry-run operation was recorded: %+v", op)
	}
	if op.Operation == nil || op.Operation.Sync == nil || !op.Operation.Sync.DryRun {
		t.Errorf("the recorded operation does not report itself as a dry run: %+v", op.Operation)
	}
	if !strings.Contains(op.Message, "dry run") {
		t.Errorf("dry-run message does not say so: %q", op.Message)
	}
}

func TestSelectiveSyncStaysOutOfSync(t *testing.T) {
	syncDuration = 20 * time.Millisecond
	t.Cleanup(func() { syncDuration = 2 * time.Second })
	srv, _ := serve(t, "orders")

	body := `{"name":"orders-worker","resources":[{"group":"apps","kind":"Deployment","name":"orders-worker","namespace":"orders-worker"}]}`
	if code := post(t, srv, "/api/v1/applications/orders-worker/sync", body, nil); code != 200 {
		t.Fatalf("selective sync: status %d", code)
	}
	time.Sleep(100 * time.Millisecond)

	var out application
	get(t, srv, "/api/v1/applications/orders-worker", &out)
	if out.Status.Sync.Status != "OutOfSync" {
		t.Errorf("a selective sync marked the whole app %q", out.Status.Sync.Status)
	}
	r := out.Status.OperationState.SyncResult
	if r == nil || len(r.Resources) != 1 || r.Resources[0].Kind != "Deployment" {
		t.Fatalf("selective sync result should name only the selected resource: %+v", r)
	}
}

func TestSyncUnknownApplication(t *testing.T) {
	srv, _ := serve(t, "home")
	if code := post(t, srv, "/api/v1/applications/not-a-thing/sync", `{}`, nil); code != 404 {
		t.Errorf("sync of an unknown app: status %d, want 404", code)
	}
	if code := post(t, srv, "/api/v1/applications/doc-archive/sync", `{nope`, nil); code != 400 {
		t.Errorf("malformed sync body: status %d, want 400", code)
	}
}

// TestManagedResourcesDiffer is the check the whole diff feature rests on:
// a drifted application must present every kind of difference at once, and a
// synced one none at all -- with matching resources listed either way.
func TestManagedResourcesDiffer(t *testing.T) {
	srv, _ := serve(t, "home")

	var res struct{ Items []resourceDiff }
	get(t, srv, "/api/v1/applications/doc-archive/managed-resources", &res)
	if len(res.Items) < 6 {
		t.Fatalf("got %d managed resources, want at least 6", len(res.Items))
	}

	var changed, added, removed, unchanged int
	for _, d := range res.Items {
		for _, state := range []string{d.TargetState, d.LiveState, d.NormalizedLiveState, d.PredictedLiveState} {
			if !json.Valid([]byte(state)) {
				t.Errorf("%s/%s: state is not JSON: %q", d.Kind, d.Name, state)
			}
		}
		switch {
		case d.LiveState == absent:
			added++ // in git, not in the cluster
		case d.TargetState == absent:
			removed++ // in the cluster, not in git
		case d.Modified:
			changed++
		default:
			unchanged++
		}
	}
	if added != 1 || removed != 1 || changed < 2 || unchanged < 2 {
		t.Errorf("drifted app diff: %d changed, %d added, %d removed, %d unchanged", changed, added, removed, unchanged)
	}

	// The image tag and the replica count are the two differences the diff
	// view is expected to render; the label is the third.
	var deploy resourceDiff
	for _, d := range res.Items {
		if d.Kind == "Deployment" {
			deploy = d
		}
	}
	if !strings.Contains(deploy.TargetState, ":1.4.2") || !strings.Contains(deploy.LiveState, ":1.4.1") {
		t.Errorf("deployment image tag does not differ: %s", deploy.LiveState)
	}
	if !strings.Contains(deploy.TargetState, `"replicas":3`) || !strings.Contains(deploy.LiveState, `"replicas":2`) {
		t.Errorf("deployment replica count does not differ: %s", deploy.LiveState)
	}
	for _, d := range res.Items {
		if d.Kind == "Service" && !strings.Contains(d.TargetState, "part-of") {
			t.Error("the added label is missing from the service's target state")
		}
	}

	// A synced application: same resources, nothing to show. A fresh value to
	// decode into, because reusing one keeps the fields the next response
	// omits -- which for an omitempty flag reads as the opposite of the truth.
	var synced struct{ Items []resourceDiff }
	get(t, srv, "/api/v1/applications/grafana/managed-resources", &synced)
	if len(synced.Items) == 0 {
		t.Fatal("a synced app reports no managed resources at all")
	}
	for _, d := range synced.Items {
		if d.Modified || d.LiveState == absent || d.TargetState == absent {
			t.Errorf("synced app %s/%s differs", d.Kind, d.Name)
		}
	}
}

func TestManifests(t *testing.T) {
	srv, _ := serve(t, "home")
	var out manifestResponse
	get(t, srv, "/api/v1/applications/doc-archive/manifests", &out)
	if len(out.Manifests) != 5 {
		t.Fatalf("got %d manifests, want 5 (everything in git)", len(out.Manifests))
	}
	for _, m := range out.Manifests {
		var o map[string]any
		if err := json.Unmarshal([]byte(m), &o); err != nil {
			t.Fatalf("manifest is not a JSON object: %v", err)
		}
		if o["kind"] == nil || o["apiVersion"] == nil {
			t.Errorf("manifest has no kind/apiVersion: %s", m)
		}
	}
	if out.Namespace != "doc-archive" || out.Revision == "" {
		t.Errorf("manifest response metadata: %+v", out)
	}
	// The revision asked for is the revision answered with.
	get(t, srv, "/api/v1/applications/doc-archive/manifests?revision=v2.1.0", &out)
	if out.Revision != "v2.1.0" {
		t.Errorf("revision = %q, want v2.1.0", out.Revision)
	}
}

func TestResourceActionsAreKindDependent(t *testing.T) {
	srv, _ := serve(t, "home")
	const base = "/api/v1/applications/doc-archive/resource/actions"

	cases := []struct {
		query string
		want  []string
	}{
		{"?group=apps&kind=Deployment&resourceName=doc-archive&version=v1&namespace=doc-archive", []string{"restart", "pause", "resume"}},
		{"?group=argoproj.io&kind=Rollout&resourceName=doc-archive&version=v1alpha1", []string{"pause", "resume", "promote-full"}},
		{"?group=batch&kind=CronJob&resourceName=doc-archive-backup&version=v1", []string{"create-job", "suspend", "resume"}},
		{"?kind=Pod&resourceName=doc-archive-7d9f8b6b8-x2k9v&version=v1", nil},
		{"?kind=Service&resourceName=doc-archive&version=v1", nil},
		{"?kind=ConfigMap&resourceName=doc-archive-config&version=v1", nil},
	}
	for _, c := range cases {
		var out struct {
			Actions []resourceAction `json:"actions"`
		}
		get(t, srv, base+c.query, &out)
		if len(out.Actions) != len(c.want) {
			t.Errorf("%s: got %v, want %v", c.query, out.Actions, c.want)
			continue
		}
		for i, name := range c.want {
			if out.Actions[i].Name != name {
				t.Errorf("%s: action %d = %q, want %q", c.query, i, out.Actions[i].Name, name)
			}
		}
	}

	// The empty case must be an empty list, not a null: a client cannot
	// render "no actions here" off a missing field.
	resp, err := http.Get(srv.URL + base + "?kind=Pod&version=v1&resourceName=x")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), `"actions":[]`) {
		t.Errorf("empty actions response = %s", body)
	}
}

func TestRunResourceAction(t *testing.T) {
	srv, _ := serve(t, "home")
	const q = "?namespace=doc-archive&resourceName=doc-archive&version=v1&group=apps&kind=Deployment"

	// The deprecated endpoint: the action name is the whole body.
	if code := post(t, srv, "/api/v1/applications/doc-archive/resource/actions"+q, `"restart"`, nil); code != 200 {
		t.Errorf("restart: status %d", code)
	}
	// The v2 endpoint: the request is an object.
	body := `{"name":"doc-archive","namespace":"doc-archive","resourceName":"doc-archive","version":"v1","group":"apps","kind":"Deployment","action":"restart"}`
	if code := post(t, srv, "/api/v1/applications/doc-archive/resource/actions/v2", body, nil); code != 200 {
		t.Errorf("restart (v2): status %d", code)
	}
	// A kind that offers nothing, and an action that is offered but disabled.
	if code := post(t, srv, "/api/v1/applications/doc-archive/resource/actions?kind=ConfigMap&version=v1&resourceName=doc-archive-config", `"restart"`, nil); code != 400 {
		t.Errorf("restart on a ConfigMap: status %d, want 400", code)
	}
	if code := post(t, srv, "/api/v1/applications/doc-archive/resource/actions"+q, `"resume"`, nil); code != 400 {
		t.Errorf("disabled action: status %d, want 400", code)
	}
	if code := post(t, srv, "/api/v1/applications/nope/resource/actions"+q, `"restart"`, nil); code != 404 {
		t.Errorf("unknown app: status %d, want 404", code)
	}
}
