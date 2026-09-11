package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testSessions(t *testing.T) *Sessions {
	t.Helper()
	s, err := NewSessions([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestNewSessionsRejectsShortKey(t *testing.T) {
	if _, err := NewSessions([]byte("too-short")); err == nil {
		t.Error("expected rejection of a key shorter than 32 bytes")
	}
}

func TestIssueAndVerify(t *testing.T) {
	s := testSessions(t)
	now := time.Now()
	tok, exp := s.Issue(now)
	if !exp.After(now.Add(89 * 24 * time.Hour)) {
		t.Errorf("expiry %v is not ~90 days out", exp)
	}
	iat, ok := s.Verify(tok, now)
	if !ok {
		t.Fatal("freshly issued token rejected")
	}
	if iat.Unix() != now.Unix() {
		t.Errorf("issuedAt = %v, want %v", iat, now)
	}
}

func TestVerifyRejectsTamperedAndExpired(t *testing.T) {
	s := testSessions(t)
	now := time.Now()
	tok, _ := s.Issue(now)

	if _, ok := s.Verify(tok+"x", now); ok {
		t.Error("tampered signature accepted")
	}
	if _, ok := s.Verify("garbage", now); ok {
		t.Error("malformed token accepted")
	}
	if _, ok := s.Verify(tok, now.Add(SessionTTL+time.Minute)); ok {
		t.Error("expired token accepted")
	}

	other, err := NewSessions([]byte("ffffffffffffffffffffffffffffffff"))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := other.Verify(tok, now); ok {
		t.Error("token signed with a different key accepted")
	}
}

func TestRequireRejectsUnauthenticated(t *testing.T) {
	s := testSessions(t)
	h := s.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("handler must not run")
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/apps", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
}

func TestRequireRenewsOnlyOldTokens(t *testing.T) {
	s := testSessions(t)
	h := s.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	fresh, _ := s.Issue(time.Now())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/api/apps", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: fresh})
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Error("a fresh session must not be reissued")
	}

	old, _ := s.Issue(time.Now().Add(-RenewAfter - time.Hour))
	rec = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/api/apps", nil)
	req.AddCookie(&http.Cookie{Name: CookieName, Value: old})
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	set := rec.Header().Get("Set-Cookie")
	if !strings.Contains(set, CookieName+"=") || !strings.Contains(set, "HttpOnly") {
		t.Errorf("expected a reissued HttpOnly cookie, got %q", set)
	}
}
