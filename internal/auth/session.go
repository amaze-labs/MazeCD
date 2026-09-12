package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	// CookieName holds the signed session token.
	CookieName = "mazecd_session"
	// SessionTTL is how long a session stays valid without being reissued.
	SessionTTL = 90 * 24 * time.Hour
	// RenewAfter is the age at which a session is reissued on use, so that an
	// app opened at least once every SessionTTL never needs a new login.
	RenewAfter = 24 * time.Hour
	// RequiredHeader marks a 401 as MazeCD's own session check failing. Every
	// proxied call returns ArgoCD's status verbatim, so a 401 from an expired
	// instance token is indistinguishable from a dead session without it --
	// and the client would bounce the operator to the login screen on every
	// poll. Only the responses written here carry it.
	RequiredHeader = "X-MazeCD-Auth"
)

// Sessions issues and verifies signed session tokens.
type Sessions struct {
	key []byte
}

// NewSessions requires at least 32 bytes of key material.
func NewSessions(key []byte) (*Sessions, error) {
	if len(key) < 32 {
		return nil, errors.New("session key must be at least 32 bytes")
	}
	return &Sessions{key: key}, nil
}

// Issue returns a token valid for SessionTTL from now.
func (s *Sessions) Issue(now time.Time) (string, time.Time) {
	exp := now.Add(SessionTTL)
	payload := fmt.Sprintf("%d|%d", now.Unix(), exp.Unix())
	body := base64.RawURLEncoding.EncodeToString([]byte(payload))
	return body + "." + s.sign(body), exp
}

// Verify checks the signature and expiry, returning when the token was issued.
func (s *Sessions) Verify(token string, now time.Time) (time.Time, bool) {
	body, mac, found := strings.Cut(token, ".")
	if !found || !hmac.Equal([]byte(mac), []byte(s.sign(body))) {
		return time.Time{}, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return time.Time{}, false
	}
	iatStr, expStr, found := strings.Cut(string(raw), "|")
	if !found {
		return time.Time{}, false
	}
	iat, err1 := strconv.ParseInt(iatStr, 10, 64)
	exp, err2 := strconv.ParseInt(expStr, 10, 64)
	if err1 != nil || err2 != nil || now.Unix() >= exp {
		return time.Time{}, false
	}
	return time.Unix(iat, 0), true
}

func (s *Sessions) sign(body string) string {
	m := hmac.New(sha256.New, s.key)
	m.Write([]byte(body))
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// SetCookie writes the session cookie. Secure is always set; browsers treat
// http://localhost as a secure context, so development is unaffected.
func (s *Sessions) SetCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearCookie expires the session cookie.
func (s *Sessions) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	})
}

// Require rejects unauthenticated requests and slides the session forward when
// the presented token is older than RenewAfter.
func (s *Sessions) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(CookieName)
		if err != nil {
			unauthenticated(w)
			return
		}
		now := time.Now()
		iat, ok := s.Verify(c.Value, now)
		if !ok {
			s.ClearCookie(w)
			unauthenticated(w)
			return
		}
		if now.Sub(iat) > RenewAfter {
			tok, exp := s.Issue(now)
			s.SetCookie(w, tok, exp)
		}
		next.ServeHTTP(w, r)
	})
}

// unauthenticated rejects a request for want of a valid MazeCD session.
func unauthenticated(w http.ResponseWriter) {
	w.Header().Set(RequiredHeader, "required")
	http.Error(w, "unauthenticated", http.StatusUnauthorized)
}
