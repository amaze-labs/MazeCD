package argocd

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
)

// Proxy returns a reverse proxy to this instance's /api/v1. The caller sets
// r.URL.Path to the upstream path before delegating.
func (c *Client) Proxy() http.Handler { return c.proxy }

func newProxy(c *Client) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Transport: c.http.Transport,
		// -1 flushes immediately: required for log streaming (?follow=true)
		// and for ArgoCD's watch endpoints.
		FlushInterval: -1,
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL.Scheme = c.base.Scheme
			pr.Out.URL.Host = c.base.Host
			pr.Out.Host = c.base.Host
			// Never forward browser credentials upstream.
			pr.Out.Header.Del("Cookie")
			pr.Out.Header.Set("Authorization", "Bearer "+c.inst.Token)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Warn("proxy failed", "instance", c.inst.Name, "path", r.URL.Path, "err", err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"error":    "instance " + c.inst.Name + " is unreachable",
				"instance": c.inst.Name,
				"detail":   err.Error(),
			})
		},
	}
}

// ProxyHandler routes /api/i/{instance}/{rest...} to the matching instance,
// rewriting the path to /api/v1/{rest}. Everything the ArgoCD API offers —
// sync, refresh, rollback, delete, events, manifests, pod logs — is reachable
// through it without per-endpoint code.
func (r *Registry) ProxyHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		name := req.PathValue("instance")
		c, ok := r.Get(name)
		if !ok {
			http.Error(w, "unknown instance", http.StatusNotFound)
			return
		}
		rest := req.PathValue("rest")
		req.URL.Path = "/api/v1/" + rest
		req.URL.RawPath = ""
		c.Proxy().ServeHTTP(w, req)
	})
}
