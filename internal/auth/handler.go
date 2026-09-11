package auth

import (
	"encoding/json"
	"net"
	"net/http"
	"time"
)

// Handler serves the application login endpoints.
type Handler struct {
	passwordHash string
	sessions     *Sessions
	limiter      *Limiter
}

// NewHandler builds the auth endpoints for the single application password.
func NewHandler(passwordHash string, sessions *Sessions) *Handler {
	return &Handler{
		passwordHash: passwordHash,
		sessions:     sessions,
		limiter:      NewLimiter(5, 15*time.Minute),
	}
}

// Mount registers the auth routes.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/login", h.login)
	mux.HandleFunc("POST /api/auth/logout", h.logout)
	mux.Handle("GET /api/auth/me", h.sessions.Require(http.HandlerFunc(h.me)))
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	if !h.limiter.Allow(clientIP(r), time.Now()) {
		http.Error(w, "too many attempts, try again later", http.StatusTooManyRequests)
		return
	}
	var body struct{ Password string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if !VerifyPassword(h.passwordHash, body.Password) {
		http.Error(w, "invalid password", http.StatusUnauthorized)
		return
	}
	tok, exp := h.sessions.Issue(time.Now())
	h.sessions.SetCookie(w, tok, exp)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	h.sessions.ClearCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]bool{"authenticated": true})
}

// clientIP identifies the caller for rate limiting.
// ponytail: RemoteAddr only; add X-Forwarded-For parsing if MazeCD ever runs
// behind a proxy that terminates many clients on one address.
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
