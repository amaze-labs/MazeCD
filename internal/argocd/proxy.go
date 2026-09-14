package argocd

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"path"
	"strings"

	"github.com/amaze-labs/MazeCD/internal/auth"
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
			// Join the base path (if any) onto the request path, e.g.
			// for an instance at https://host/argocd, prepend /argocd.
			if c.base.Path != "" {
				pr.Out.URL.Path = c.base.Path + pr.Out.URL.Path
			}
			// Never forward browser credentials upstream.
			pr.Out.Header.Del("Cookie")
			pr.Out.Header.Set("Authorization", "Bearer "+c.inst.Token)
		},
		// "Tokens never reach the device" cuts both ways: the request drops
		// the browser's Cookie, and the response must not plant one of
		// ArgoCD's on MazeCD's origin. The upstream also must not be able to
		// forge auth.RequiredHeader: the client trusts it to tell a dead
		// MazeCD session from an ArgoCD rejection, so a compromised or
		// misconfigured instance echoing it back on a 401 would put the
		// operator right back in the logout loop that header exists to
		// prevent.
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("Set-Cookie")
			resp.Header.Del(auth.RequiredHeader)
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			// A browser that backgrounded the tab or navigated away cancels
			// its watch stream, and every cancellation lands here. That is
			// the client hanging up, not the instance failing: logging it as
			// a failure would bury real ones under three warnings per screen
			// lock, and there is nobody left to write a 502 body to.
			if r.Context().Err() != nil {
				return
			}
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
		// Clean the path to resolve . and .. segments. Reject any path that
		// escapes the /api/v1 prefix, including percent-encoded traversal
		// attempts like %2e%2e which PathValue unescapes after mux routing.
		p := path.Clean("/api/v1/" + rest)
		if p != "/api/v1" && !strings.HasPrefix(p, "/api/v1/") {
			http.Error(w, "invalid path", http.StatusBadRequest)
			return
		}
		req.URL.Path = p
		req.URL.RawPath = ""
		c.Proxy().ServeHTTP(w, req)
	})
}
