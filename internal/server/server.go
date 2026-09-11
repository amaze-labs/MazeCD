// Package server wires the MazeCD route table.
package server

import (
	"encoding/json"
	"net/http"

	"github.com/amaze-labs/MazeCD/internal/argocd"
	"github.com/amaze-labs/MazeCD/internal/auth"
)

// Options are the dependencies of the HTTP handler.
type Options struct {
	Registry     *argocd.Registry
	Sessions     *auth.Sessions
	PasswordHash string
	Version      string
	Static       http.Handler
	// Passkeys is optional; nil disables the passkey routes (Task 19).
	Passkeys interface{ Mount(*http.ServeMux) }
}

// New builds the complete handler: API under /api, PWA everywhere else.
func New(opts Options) http.Handler {
	api := http.NewServeMux()

	api.HandleFunc("GET /api/version", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"version": opts.Version})
	})

	auth.NewHandler(opts.PasswordHash, opts.Sessions).Mount(api)
	if opts.Passkeys != nil {
		opts.Passkeys.Mount(api)
	}

	require := opts.Sessions.Require

	api.Handle("GET /api/instances", require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, opts.Registry.Instances(r.Context()))
	})))

	api.Handle("GET /api/apps", require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, opts.Registry.Apps(r.Context()))
	})))

	// Everything else ArgoCD exposes goes through the proxy.
	api.Handle("/api/i/{instance}/{rest...}", require(opts.Registry.ProxyHandler()))

	root := http.NewServeMux()
	root.Handle("/api/", noStore(api))
	root.Handle("/", opts.Static)
	return root
}

// noStore guarantees no ArgoCD state is ever cached by a browser or proxy.
func noStore(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
