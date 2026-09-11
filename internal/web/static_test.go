package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html>shell")},
		"manifest.webmanifest": {Data: []byte("{}")},
		"sw.js":                {Data: []byte("// service worker")},
		"assets/app-abc123.js": {Data: []byte("console.log(1)")},
	}
}

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
	return rec
}

func TestHashedAssetsAreImmutable(t *testing.T) {
	rec := get(handlerFor(testFS()), "/assets/app-abc123.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q, want immutable", cc)
	}
}

func TestShellAndWorkerAreNeverCached(t *testing.T) {
	h := handlerFor(testFS())
	for _, path := range []string{"/", "/index.html", "/sw.js", "/manifest.webmanifest"} {
		rec := get(h, path)
		if rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200", path, rec.Code)
		}
		if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", path, cc)
		}
	}
}

func TestUnknownRouteFallsBackToShell(t *testing.T) {
	rec := get(handlerFor(testFS()), "/apps/prod/web")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 for a client-side route", rec.Code)
	}
	if rec.Body.String() != "<!doctype html>shell" {
		t.Errorf("body = %q, want the app shell", rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestMissingAssetIs404(t *testing.T) {
	rec := get(handlerFor(testFS()), "/assets/gone-000000.js")
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for a missing hashed asset", rec.Code)
	}
}
