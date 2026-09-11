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
  "status":{"health":{"status":"Degraded"},"sync":{"status":"OutOfSync","revision":"abc1234"},
            "operationState":{"phase":"Running"}}},
 {"metadata":{"name":"api","namespace":"argocd"},
  "spec":{"project":"default","destination":{"server":"https://kubernetes.default.svc","namespace":"api-prod"}},
  "status":{"health":{"status":"Healthy"},"sync":{"status":"Synced","revision":"def5678"}}}
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
	if len(res.Apps) != 2 {
		t.Fatalf("got %d apps, want 2", len(res.Apps))
	}
	// Deterministic order: instance then name.
	if res.Apps[0].Name != "api" || res.Apps[1].Name != "web" {
		t.Errorf("apps not sorted by name: %+v", res.Apps)
	}
	web := res.Apps[1]
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
	if res.Apps[0].OperationPhase != "" {
		t.Errorf("OperationPhase = %q, want empty when there is no operation", res.Apps[0].OperationPhase)
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
	if len(res.Apps) != 2 {
		t.Errorf("got %d apps, want the 2 from the healthy instance", len(res.Apps))
	}
	if len(res.Errors) != 1 || res.Errors[0].Instance != "staging" {
		t.Fatalf("want one error for staging, got %+v", res.Errors)
	}
	if res.Errors[0].Message == "" {
		t.Error("error message is empty")
	}
}
