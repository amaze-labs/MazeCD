package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testHandler(t *testing.T) (*http.ServeMux, string) {
	t.Helper()
	hash, err := HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	NewHandler(hash, testSessions(t)).Mount(mux)
	return mux, hash
}

func post(t *testing.T, mux *http.ServeMux, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = "1.2.3.4:5555"
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func TestLoginSuccessSetsCookie(t *testing.T) {
	mux, _ := testHandler(t)
	rec := post(t, mux, "/api/auth/login", `{"password":"hunter2"}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), CookieName+"=") {
		t.Errorf("no session cookie set: %q", rec.Header().Get("Set-Cookie"))
	}
}

func TestLoginWrongPassword(t *testing.T) {
	mux, _ := testHandler(t)
	rec := post(t, mux, "/api/auth/login", `{"password":"nope"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Error("a cookie was set on a failed login")
	}
}

func TestLoginRateLimited(t *testing.T) {
	mux, _ := testHandler(t)
	for i := 0; i < 5; i++ {
		post(t, mux, "/api/auth/login", `{"password":"nope"}`)
	}
	rec := post(t, mux, "/api/auth/login", `{"password":"hunter2"}`)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 after five failures", rec.Code)
	}
}

func TestMeRequiresSession(t *testing.T) {
	mux, _ := testHandler(t)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/me", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}

func TestLogoutClearsCookie(t *testing.T) {
	mux, _ := testHandler(t)
	rec := post(t, mux, "/api/auth/logout", "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if !strings.Contains(rec.Header().Get("Set-Cookie"), "Max-Age=0") {
		t.Errorf("cookie not cleared: %q", rec.Header().Get("Set-Cookie"))
	}
}
