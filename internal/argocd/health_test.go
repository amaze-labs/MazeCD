package argocd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

func TestInstancesReportsHealthWithoutLeakingTokens(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/session/userinfo" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"loggedIn":true,"username":"mazecd"}`))
	}))
	defer ok.Close()
	revoked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "token revoked", http.StatusUnauthorized)
	}))
	defer revoked.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: ok.URL, Token: "supersecret", Color: "#ef4444", Production: true},
		{Name: "dev", URL: revoked.URL, Token: "othersecret", Color: "#3b82f6"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	got := reg.Instances(context.Background())
	if len(got) != 2 {
		t.Fatalf("got %d instances, want 2", len(got))
	}
	prod, dev := got[0], got[1]
	if prod.Name != "prod" || !prod.Reachable || !prod.TokenValid || prod.Error != "" {
		t.Errorf("prod = %+v, want reachable with a valid token", prod)
	}
	if !prod.Production || prod.Color != "#ef4444" {
		t.Errorf("prod metadata not surfaced: %+v", prod)
	}
	if dev.TokenValid {
		t.Error("dev token reported valid despite a 401")
	}
	if dev.Error == "" {
		t.Error("dev has no error message")
	}
	for _, in := range got {
		if strings.Contains(in.Error, "supersecret") || strings.Contains(in.Error, "othersecret") {
			t.Fatal("an instance token leaked into the response")
		}
	}
}
