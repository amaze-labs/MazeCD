// Package argocd talks to one or more ArgoCD API servers.
package argocd

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/amaze-labs/MazeCD/internal/config"
)

// StatusError is a non-2xx response from an ArgoCD API server. The upstream
// body is preserved verbatim: a generic message would hide the real cause.
type StatusError struct {
	Code int
	Body string
}

func (e *StatusError) Error() string {
	return fmt.Sprintf("argocd returned %d: %s", e.Code, e.Body)
}

// Client is an authenticated connection to one ArgoCD instance.
type Client struct {
	inst  config.Instance
	base  *url.URL
	http  *http.Client
	proxy *httputil.ReverseProxy
}

// NewClient builds the client and its TLS configuration.
func NewClient(inst config.Instance) (*Client, error) {
	base, err := url.Parse(inst.URL)
	if err != nil {
		return nil, fmt.Errorf("instance %s: %w", inst.Name, err)
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: inst.InsecureSkipVerify}
	if inst.CACert != "" {
		pem, err := os.ReadFile(inst.CACert)
		if err != nil {
			return nil, fmt.Errorf("instance %s: read caCert: %w", inst.Name, err)
		}
		pool, err := x509.SystemCertPool()
		if err != nil {
			pool = x509.NewCertPool()
		}
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("instance %s: caCert %s contains no certificate", inst.Name, inst.CACert)
		}
		tlsCfg.RootCAs = pool
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsCfg
	c := &Client{
		inst: inst,
		base: base,
		// No global client timeout: log streaming is a long-lived response.
		// Callers bound their own requests with a context.
		http: &http.Client{Transport: transport},
	}
	c.proxy = newProxy(c)
	return c, nil
}

// Instance returns the configuration this client was built from.
func (c *Client) Instance() config.Instance { return c.inst }

// Get performs an authenticated GET against /api/v1/<path> and decodes JSON.
func (c *Client) Get(ctx context.Context, path string, out any) error {
	u := c.base.JoinPath("/api/v1", path)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.inst.Token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return &StatusError{Code: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// Registry holds one client per configured instance, in config order.
type Registry struct {
	byName map[string]*Client
	order  []*Client
}

// NewRegistry builds every client up front so a bad TLS setup fails at startup.
func NewRegistry(cfg *config.Config) (*Registry, error) {
	r := &Registry{byName: make(map[string]*Client, len(cfg.Instances))}
	for _, inst := range cfg.Instances {
		c, err := NewClient(inst)
		if err != nil {
			return nil, err
		}
		r.byName[inst.Name] = c
		r.order = append(r.order, c)
	}
	return r, nil
}

// Get returns the client for an instance name.
func (r *Registry) Get(name string) (*Client, bool) {
	c, ok := r.byName[name]
	return c, ok
}

// All returns every client in configuration order.
func (r *Registry) All() []*Client { return r.order }

// instanceTimeout bounds per-instance calls made on behalf of one browser request.
const instanceTimeout = 5 * time.Second
