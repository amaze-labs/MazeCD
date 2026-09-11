package argocd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

// mount wires the proxy exactly as the server does, so the test exercises the
// real routing pattern.
func mount(reg *Registry) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/api/i/{instance}/{rest...}", reg.ProxyHandler())
	return mux
}

func TestProxyRewritesPathAndInjectsToken(t *testing.T) {
	var got *http.Request
	var body string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(r.Context())
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: upstream.URL, Token: "prodtok"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/api/i/prod/applications/web/sync?appNamespace=argocd", strings.NewReader(`{"prune":true}`))
	req.Header.Set("Authorization", "Bearer attacker-supplied")
	req.AddCookie(&http.Cookie{Name: "mazecd_session", Value: "secret"})
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got.URL.Path != "/api/v1/applications/web/sync" {
		t.Errorf("upstream path = %q, want /api/v1/applications/web/sync", got.URL.Path)
	}
	if got.URL.RawQuery != "appNamespace=argocd" {
		t.Errorf("query = %q, want appNamespace=argocd", got.URL.RawQuery)
	}
	if got.Header.Get("Authorization") != "Bearer prodtok" {
		t.Errorf("Authorization = %q, want the instance token", got.Header.Get("Authorization"))
	}
	if got.Header.Get("Cookie") != "" {
		t.Error("the MazeCD session cookie was forwarded to ArgoCD")
	}
	if body != `{"prune":true}` {
		t.Errorf("body = %q, want the request body forwarded unchanged", body)
	}
}

func TestProxyUnknownInstance(t *testing.T) {
	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: "https://p.internal", Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/staging/applications", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestProxyUnreachableUpstreamReturns502(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := dead.URL
	dead.Close() // nothing is listening any more

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: url, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/prod/applications", nil))
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "prod") {
		t.Errorf("error body %q does not name the instance", rec.Body.String())
	}
}

func TestProxyRejectsPercentEncodedPathTraversal(t *testing.T) {
	upstreamCalled := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: upstream.URL, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/prod/%2e%2e/%2e%2e/admin", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
	if upstreamCalled {
		t.Error("upstream was called for path traversal attempt; it should have been rejected")
	}
}

func TestProxyPreservesInstanceBasePath(t *testing.T) {
	var got *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(r.Context())
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: upstream.URL + "/argocd", Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/prod/applications", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if got.URL.Path != "/argocd/api/v1/applications" {
		t.Errorf("upstream path = %q, want /argocd/api/v1/applications", got.URL.Path)
	}
}

func TestProxyDeletesAllCookieHeaders(t *testing.T) {
	var got *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(r.Context())
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer upstream.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: upstream.URL, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("GET", "/api/i/prod/applications", nil)
	// Manually add multiple Cookie header lines (as the browser would send them)
	req.Header.Add("Cookie", "session=abc123")
	req.Header.Add("Cookie", "prefs=dark_mode")
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
	if got.Header.Get("Cookie") != "" {
		t.Errorf("upstream Cookie header = %q, want empty", got.Header.Get("Cookie"))
	}
}
