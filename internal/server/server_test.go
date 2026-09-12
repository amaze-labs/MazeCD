package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/amaze-labs/MazeCD/internal/argocd"
	"github.com/amaze-labs/MazeCD/internal/auth"
	"github.com/amaze-labs/MazeCD/internal/config"
)

func testServer(t *testing.T) (http.Handler, *auth.Sessions) {
	t.Helper()
	cfg := &config.Config{Instances: []config.Instance{
		{Name: "prod", URL: "https://p.internal", Token: "t", Color: "#ef4444"},
	}}
	reg, err := argocd.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := auth.NewSessions([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	h := New(Options{
		Registry:     reg,
		Sessions:     sessions,
		PasswordHash: hash,
		Version:      "test-1",
		Static:       http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("shell")) }),
	})
	return h, sessions
}

func TestProtectedRoutesRequireSession(t *testing.T) {
	h, _ := testServer(t)
	for _, path := range []string{"/api/apps", "/api/instances", "/api/i/prod/applications"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", path, rec.Code)
		}
	}
}

func TestVersionIsPublicAndUncached(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/version", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "test-1") {
		t.Errorf("body = %q, want the build version", rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestAPIResponsesAreUncached(t *testing.T) {
	h, sessions := testServer(t)
	tok, _ := sessions.Issue(timeNow())
	req := httptest.NewRequest("GET", "/api/instances", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestUnknownAPIRouteIsNotTheShell(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "shell") {
		t.Error("an unknown API route returned the app shell")
	}
}

func TestClientRouteServesShell(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/apps/prod/web", nil))
	if rec.Body.String() != "shell" {
		t.Errorf("body = %q, want the app shell", rec.Body.String())
	}
}

// A 401 from MazeCD's own session check and a 401 forwarded from ArgoCD are
// the same status code on the wire; only the header tells them apart, and the
// client logs the operator out on one but not the other.
func TestSessionRejectionIsMarkedButProxied401IsNot(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "token revoked", http.StatusUnauthorized)
	}))
	defer upstream.Close()

	cfg := &config.Config{Instances: []config.Instance{
		{Name: "prod", URL: upstream.URL, Token: "t", Color: "#ef4444"},
	}}
	reg, err := argocd.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := auth.NewSessions([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	h := New(Options{Registry: reg, Sessions: sessions, PasswordHash: "x", Version: "test-1",
		Static: http.NotFoundHandler()})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/prod/applications", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no session: status = %d, want 401", rec.Code)
	}
	if rec.Header().Get(auth.RequiredHeader) == "" {
		t.Errorf("no session: %s header missing, the client cannot tell this is a dead session", auth.RequiredHeader)
	}

	tok, _ := sessions.Issue(time.Now())
	req := httptest.NewRequest("GET", "/api/i/prod/applications", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked instance token: status = %d, want ArgoCD's 401 verbatim", rec.Code)
	}
	if got := rec.Header().Get(auth.RequiredHeader); got != "" {
		t.Errorf("%s = %q on a proxied 401: the client would log the operator out in a loop", auth.RequiredHeader, got)
	}
	if !strings.Contains(rec.Body.String(), "token revoked") {
		t.Errorf("body = %q, want ArgoCD's own message", rec.Body.String())
	}
}

func timeNow() time.Time { return time.Now() }
