// Package web serves the built PWA embedded in the binary.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

// dist holds the Vite build output. The `all:` prefix keeps dotfiles such as
// the .gitkeep placeholder, so the package compiles before the first build.
//
//go:embed all:dist
var dist embed.FS

// Handler serves the built PWA with the cache policy the update strategy relies on.
func Handler() (http.Handler, error) {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, err
	}
	return handlerFor(sub), nil
}

func handlerFor(fsys fs.FS) http.Handler {
	files := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(fsys, name); err != nil {
			// A hashed asset that is missing is a real 404; anything else is a
			// client-side route and must receive the shell.
			if strings.HasPrefix(name, "assets/") {
				http.NotFound(w, r)
				return
			}
			serveShell(w, r, fsys)
			return
		}
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			r.URL.Path = "/" + name
			files.ServeHTTP(w, r)
			return
		}
		if name == "index.html" {
			// http.FileServer redirects any request path ending in
			// "/index.html" back to "/", so serve the shell directly instead
			// of forwarding to it.
			serveShell(w, r, fsys)
			return
		}
		// The service worker and the manifest must never be cached, or a
		// released build can be shadowed by an old client.
		w.Header().Set("Cache-Control", "no-store")
		r.URL.Path = "/" + name
		files.ServeHTTP(w, r)
	})
}

func serveShell(w http.ResponseWriter, r *http.Request, fsys fs.FS) {
	shell, err := fs.ReadFile(fsys, "index.html")
	if err != nil {
		http.Error(w, "the PWA has not been built", http.StatusNotFound)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(shell)
}
