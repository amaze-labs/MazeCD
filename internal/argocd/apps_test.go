package argocd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

const appListJSON = `{"items":[
 {"metadata":{"name":"web","namespace":"argocd"},
  "spec":{"project":"default","destination":{"server":"https://kubernetes.default.svc","namespace":"web-prod"}},
  "status":{"health":{"status":"Degraded","message":"readiness probe failed"},"sync":{"status":"OutOfSync","revision":"abc1234"},
            "operationState":{"phase":"Running","finishedAt":"2026-09-14T08:00:00Z"},
            "resources":[
              {"kind":"Deployment","name":"web","health":{"status":"Degraded"}},
              {"kind":"Pod","name":"web-x2k9v","health":{"status":"Degraded"}},
              {"kind":"Service","name":"web"}
            ]}},
 {"metadata":{"name":"api","namespace":"argocd"},
  "spec":{"project":"default","destination":{"server":"https://kubernetes.default.svc","namespace":"api-prod"}},
  "status":{"health":{"status":"Healthy"},"sync":{"status":"Synced","revision":"def5678"},
            "resources":[]}},
 {"metadata":{"name":"nores","namespace":"argocd"},
  "spec":{"project":"default","destination":{"server":"https://kubernetes.default.svc","namespace":"nores-prod"}},
  "status":{"health":{"status":"Healthy"},"sync":{"status":"Synced","revision":"ffffff"}}}
]}`

func TestAppsAggregatesAndTagsInstance(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/applications" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(appListJSON))
	}))
	defer up.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: up.URL, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	res := reg.Apps(context.Background())
	if len(res.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", res.Errors)
	}
	if len(res.Apps) != 3 {
		t.Fatalf("got %d apps, want 3", len(res.Apps))
	}
	// Deterministic order: instance then name.
	if res.Apps[0].Name != "api" || res.Apps[1].Name != "nores" || res.Apps[2].Name != "web" {
		t.Errorf("apps not sorted by name: %+v", res.Apps)
	}
	api := res.Apps[0]
	nores := res.Apps[1]
	web := res.Apps[2]
	if web.Instance != "prod" {
		t.Errorf("Instance = %q, want prod", web.Instance)
	}
	if web.Health != "Degraded" || web.Sync != "OutOfSync" {
		t.Errorf("status = %s/%s, want Degraded/OutOfSync", web.Health, web.Sync)
	}
	if web.Revision != "abc1234" || web.DestNamespace != "web-prod" || web.Project != "default" {
		t.Errorf("unexpected fields: %+v", web)
	}
	if web.OperationPhase != "Running" {
		t.Errorf("OperationPhase = %q, want Running", web.OperationPhase)
	}
	if web.HealthMessage != "readiness probe failed" {
		t.Errorf("HealthMessage = %q, want \"readiness probe failed\"", web.HealthMessage)
	}
	if api.OperationPhase != "" {
		t.Errorf("OperationPhase = %q, want empty when there is no operation", api.OperationPhase)
	}
	if api.HealthMessage != "" {
		t.Errorf("HealthMessage = %q, want empty for healthy app", api.HealthMessage)
	}

	// web: degraded app, three resources, two of which report a non-Healthy
	// status and one (the Service) reports no health at all -- that one must
	// not be counted as unhealthy.
	if web.OperationFinishedAt != "2026-09-14T08:00:00Z" {
		t.Errorf("OperationFinishedAt = %q, want 2026-09-14T08:00:00Z", web.OperationFinishedAt)
	}
	if web.TotalResources == nil || *web.TotalResources != 3 {
		t.Errorf("TotalResources = %v, want 3", web.TotalResources)
	}
	if web.UnhealthyResources != 2 {
		t.Errorf("UnhealthyResources = %d, want 2", web.UnhealthyResources)
	}

	// api: ArgoCD reported an explicit, empty resources list -- 0 resources
	// is a fact, not an absence of one.
	if api.OperationFinishedAt != "" {
		t.Errorf("OperationFinishedAt = %q, want empty when there is no operation", api.OperationFinishedAt)
	}
	if api.TotalResources == nil || *api.TotalResources != 0 {
		t.Errorf("TotalResources = %v, want a pointer to 0", api.TotalResources)
	}
	if api.UnhealthyResources != 0 {
		t.Errorf("UnhealthyResources = %d, want 0", api.UnhealthyResources)
	}

	// nores: the instance never sent a resources list at all -- must stay
	// nil, distinct from api's reported zero.
	if nores.TotalResources != nil {
		t.Errorf("TotalResources = %v, want nil when the instance never reported resources", nores.TotalResources)
	}
	if nores.UnhealthyResources != 0 {
		t.Errorf("UnhealthyResources = %d, want 0", nores.UnhealthyResources)
	}
}

func TestAppsReturnsPartialResultsOnFailure(t *testing.T) {
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(appListJSON))
	}))
	defer good.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer bad.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: good.URL, Token: "t"},
		{Name: "staging", URL: bad.URL, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	res := reg.Apps(context.Background())
	if len(res.Apps) != 3 {
		t.Errorf("got %d apps, want the 3 from the healthy instance", len(res.Apps))
	}
	if len(res.Errors) != 1 || res.Errors[0].Instance != "staging" {
		t.Fatalf("want one error for staging, got %+v", res.Errors)
	}
	if res.Errors[0].Message == "" {
		t.Error("error message is empty")
	}
}
