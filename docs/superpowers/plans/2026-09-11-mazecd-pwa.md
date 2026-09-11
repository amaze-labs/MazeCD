# MazeCD PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first PWA that operates multiple ArgoCD instances from one aggregated view, with a single long-lived login and updates that never get stuck on a cached build.

**Architecture:** One Go binary serves both the API and the embedded PWA from the same origin. It reads instances from a mounted YAML config (tokens via `${ENV}` expansion), reverse-proxies authenticated browser requests to each instance's `/api/v1/*` with the instance token injected, and adds one hand-written fan-out endpoint for the aggregated application list. The frontend is a React SPA polling adaptively through TanStack Query.

**Tech Stack:** Go 1.27 (stdlib `net/http`, `net/http/httputil`, `embed`; `gopkg.in/yaml.v3`, `golang.org/x/crypto/bcrypt`), React 19 + Vite + TypeScript + Tailwind v4 + TanStack Query + `vite-plugin-pwa`, Vitest, Docker multi-stage on `distroless/static`.

**Spec:** `docs/superpowers/specs/2026-09-11-mazecd-pwa-design.md`

## Global Constraints

- Go module path: `github.com/amaze-labs/MazeCD`. Go 1.27.
- The backend is **single-user**. No users table, no RBAC, no tenancy.
- Instance tokens are **never** sent to the browser and never logged. `/api/instances` returns name, color, production flag and reachability only.
- The `Authorization` header arriving from the browser is always discarded by the proxy and replaced with the instance token.
- Every `/api/*` route except `/api/auth/login`, `/api/auth/logout` and `/api/version` requires a valid session, returning `401` otherwise. Logout is exempt deliberately: it must be able to clear a corrupted or expired cookie.
- Config is read **once at startup**. A missing `${VAR}` is a fatal startup error naming the variable.
- No caching of ArgoCD responses anywhere: no server-side cache, `Cache-Control: no-store` on `/api/*`, `NetworkOnly` in the service worker.
- `index.html`, `manifest.webmanifest` and the service worker are served `no-store`; only `/assets/*` (hashed filenames) are `public, max-age=31536000, immutable`.
- Session cookie: name `mazecd_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, TTL 90 days, reissued when older than 24h.
- Status colors follow ArgoCD exactly: Healthy `#18be94` (green), Progressing `#0daeeb` with a pulse (blue), Degraded `#e96d76` (red), Suspended `#766f94` (violet-grey), Missing/Unknown `#ccd6dd` (grey), Synced green, OutOfSync `#f4c030` (amber).
- UI language: English labels (matches ArgoCD terminology operators already know).
- Deviations from the spec, both deliberate and to be reflected in it: password hashing uses **bcrypt cost 12** from `golang.org/x/crypto/bcrypt` instead of hand-rolled argon2id encoding (two library calls versus ~60 lines of parsing that is easy to get subtly wrong), and the session token is a **signed opaque token** (HMAC-SHA256 over `iat|exp`) instead of a JWT (no algorithm-confusion surface, no dependency).

---

## File Structure

**Backend**

| File | Responsibility |
|---|---|
| `go.mod`, `go.sum` | module `github.com/amaze-labs/MazeCD` |
| `cmd/mazecd/main.go` | flags/env, startup wiring, `hash` subcommand, graceful shutdown |
| `internal/config/config.go` | YAML parsing, `${ENV}` expansion, validation, instance lookup |
| `internal/auth/password.go` | bcrypt hash and verify |
| `internal/auth/session.go` | signed token issue/verify, cookie, sliding-renewal middleware |
| `internal/auth/ratelimit.go` | per-IP login attempt limiter |
| `internal/auth/handler.go` | `/api/auth/login`, `/logout`, `/me` |
| `internal/argocd/client.go` | per-instance HTTP client, TLS config, token injection, registry |
| `internal/argocd/proxy.go` | per-instance reverse proxy, streaming-safe |
| `internal/argocd/apps.go` | fan-out aggregated app list, partial failures |
| `internal/argocd/health.go` | per-instance reachability and token validity |
| `internal/web/static.go` | `go:embed` of the built PWA, cache headers, SPA fallback |
| `internal/server/server.go` | route table, version endpoint, middleware composition |

**Frontend** (`web/`)

| File | Responsibility |
|---|---|
| `vite.config.ts` | Vite, Tailwind, PWA plugin, dev proxy, `outDir: ../internal/web/dist` |
| `src/api/client.ts` | `fetch` wrapper: credentials, 401 handling, error extraction |
| `src/api/types.ts` | hand-written subset of ArgoCD types used by the UI |
| `src/api/queries.ts` | TanStack Query hooks and polling policy |
| `src/lib/sync.ts` | sync options → `SyncRequest` payload (unit tested) |
| `src/lib/update.ts` | service-worker update checks and version comparison |
| `src/lib/status.ts` | health/sync → color and icon |
| `src/screens/Login.tsx` | password login |
| `src/screens/Apps.tsx` | aggregated list, filters, search, pull-to-refresh |
| `src/screens/AppDetail.tsx` | header, action bar, tabs |
| `src/screens/Settings.tsx` | instances, build version, logout |
| `src/components/Tree.tsx` | resource tree |
| `src/components/ResourceSheet.tsx` | logs, events, manifest, delete/restart |
| `src/components/SyncSheet.tsx` | sync options form |
| `src/components/ConfirmSheet.tsx` | instance-aware confirmation, typed-name variant |
| `src/components/UpdateToast.tsx` | "new version available" |

**Packaging**

| File | Responsibility |
|---|---|
| `docker/Dockerfile` | node build → go build → distroless/static |
| `docker/compose.yaml` | local run with config and secrets |
| `.github/workflows/release.yml` | multi-arch image build and publish on merge to main |
| `.github/scripts/next-version.sh` | next semver from the conventional commits since the last tag |
| `config.example.yaml` | documented sample config |
| `README.md` | setup, env vars, token creation, deploy |

---

### Task 1: Module scaffold and config loader

**Files:**
- Create: `go.mod`, `.gitignore`, `internal/config/config.go`
- Test: `internal/config/config_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `config.Config{Listen string, Instances []Instance}`, `config.Instance{Name, URL, Token, Color string, Production bool, CACert string, InsecureSkipVerify bool}`, `config.Load(path string) (*Config, error)`, `(*Config).Instance(name string) (Instance, bool)`.

- [ ] **Step 1: Initialise the module and dependency**

```bash
go mod init github.com/amaze-labs/MazeCD
go get gopkg.in/yaml.v3
printf 'internal/web/dist/*\n!internal/web/dist/.gitkeep\nweb/node_modules/\nmazecd\n.env\ndata/\n' > .gitignore
mkdir -p internal/web/dist && touch internal/web/dist/.gitkeep
```

- [ ] **Step 2: Write the failing test**

Create `internal/config/config_test.go`:

```go
package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestLoadExpandsEnvAndDefaults(t *testing.T) {
	t.Setenv("TOK_PROD", "s3cret")
	p := writeConfig(t, `
instances:
  - name: prod
    url: https://argocd.prod.internal
    token: ${TOK_PROD}
    color: "#ef4444"
    production: true
`)
	cfg, err := Load(p)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Listen != ":8080" {
		t.Errorf("Listen = %q, want default :8080", cfg.Listen)
	}
	if len(cfg.Instances) != 1 {
		t.Fatalf("got %d instances, want 1", len(cfg.Instances))
	}
	inst := cfg.Instances[0]
	if inst.Token != "s3cret" {
		t.Errorf("Token = %q, want expanded s3cret", inst.Token)
	}
	if !inst.Production {
		t.Error("Production = false, want true")
	}
}

func TestLoadMissingEnvIsFatalAndNamesVariable(t *testing.T) {
	p := writeConfig(t, `
instances:
  - name: prod
    url: https://argocd.prod.internal
    token: ${TOK_ABSENT}
`)
	_, err := Load(p)
	if err == nil {
		t.Fatal("expected an error for an unset variable")
	}
	if !strings.Contains(err.Error(), "TOK_ABSENT") {
		t.Errorf("error %q does not name the missing variable", err)
	}
}

func TestLoadValidation(t *testing.T) {
	cases := map[string]string{
		"empty instance list": `instances: []`,
		"missing name": `
instances:
  - url: https://a.internal
    token: t
`,
		"invalid name": `
instances:
  - name: Prod_1
    url: https://a.internal
    token: t
`,
		"duplicate name": `
instances:
  - name: prod
    url: https://a.internal
    token: t
  - name: prod
    url: https://b.internal
    token: t
`,
		"missing token": `
instances:
  - name: prod
    url: https://a.internal
`,
		"non http url": `
instances:
  - name: prod
    url: ftp://a.internal
    token: t
`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Load(writeConfig(t, body)); err == nil {
				t.Fatalf("expected rejection of %s", name)
			}
		})
	}
}

func TestInstanceLookup(t *testing.T) {
	t.Setenv("T", "x")
	cfg, err := Load(writeConfig(t, `
instances:
  - name: dev
    url: https://dev.internal
    token: ${T}
`))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := cfg.Instance("dev"); !ok {
		t.Error("dev not found")
	}
	if _, ok := cfg.Instance("nope"); ok {
		t.Error("unknown instance was found")
	}
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `go test ./internal/config/`
Expected: FAIL — undefined: `Load`, `Config`.

- [ ] **Step 4: Write the implementation**

Create `internal/config/config.go`:

```go
// Package config loads the MazeCD instance configuration from a YAML file.
package config

import (
	"fmt"
	"net/url"
	"os"
	"regexp"

	"gopkg.in/yaml.v3"
)

// Instance is one ArgoCD API server MazeCD talks to.
type Instance struct {
	Name               string `yaml:"name"`
	URL                string `yaml:"url"`
	Token              string `yaml:"token"`
	Color              string `yaml:"color"`
	Production         bool   `yaml:"production"`
	CACert             string `yaml:"caCert"`
	InsecureSkipVerify bool   `yaml:"insecureSkipVerify"`
}

// Config is the whole configuration file.
type Config struct {
	Listen    string     `yaml:"listen"`
	Instances []Instance `yaml:"instances"`
}

var (
	envRef   = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}`)
	nameOK   = regexp.MustCompile(`^[a-z0-9-]+$`)
	defColor = "#8b93a7"
)

// Load reads, expands and validates the configuration at path.
func Load(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	expanded, err := expandEnv(string(raw))
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := yaml.Unmarshal([]byte(expanded), &cfg); err != nil {
		return nil, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Listen == "" {
		cfg.Listen = ":8080"
	}
	if len(cfg.Instances) == 0 {
		return nil, fmt.Errorf("config: no instances defined")
	}
	seen := map[string]bool{}
	for i := range cfg.Instances {
		inst := &cfg.Instances[i]
		if !nameOK.MatchString(inst.Name) {
			return nil, fmt.Errorf("config: instance name %q must match [a-z0-9-]+", inst.Name)
		}
		if seen[inst.Name] {
			return nil, fmt.Errorf("config: duplicate instance name %q", inst.Name)
		}
		seen[inst.Name] = true
		u, err := url.Parse(inst.URL)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return nil, fmt.Errorf("config: instance %q has an invalid url %q", inst.Name, inst.URL)
		}
		if inst.Token == "" {
			return nil, fmt.Errorf("config: instance %q has no token", inst.Name)
		}
		if inst.Color == "" {
			inst.Color = defColor
		}
	}
	return &cfg, nil
}

// Instance returns the instance with the given name.
func (c *Config) Instance(name string) (Instance, bool) {
	for _, inst := range c.Instances {
		if inst.Name == name {
			return inst, true
		}
	}
	return Instance{}, false
}

// expandEnv replaces ${VAR} with the environment value, failing on anything unset.
func expandEnv(s string) (string, error) {
	var missing string
	out := envRef.ReplaceAllStringFunc(s, func(ref string) string {
		name := ref[2 : len(ref)-1]
		val, ok := os.LookupEnv(name)
		if !ok || val == "" {
			if missing == "" {
				missing = name
			}
			return ""
		}
		return val
	})
	if missing != "" {
		return "", fmt.Errorf("config: environment variable %s is referenced but not set", missing)
	}
	return out, nil
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `go test ./internal/config/ -v`
Expected: PASS, all subtests.

- [ ] **Step 6: Commit**

```bash
git add go.mod go.sum .gitignore internal/config internal/web/dist/.gitkeep
git commit -m "feat(config): YAML instance config with env expansion and validation"
```

---

### Task 2: Password hashing and the `hash` subcommand

**Files:**
- Create: `internal/auth/password.go`, `cmd/mazecd/main.go`
- Test: `internal/auth/password_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `auth.HashPassword(password string) (string, error)`, `auth.VerifyPassword(hash, password string) bool`.

`main.go` is created here with only the `hash` subcommand; Task 9 adds the server startup path to the same file.

- [ ] **Step 1: Write the failing test**

Create `internal/auth/password_test.go`:

```go
package auth

import "testing"

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("password stored in clear")
	}
	if !VerifyPassword(hash, "correct horse battery staple") {
		t.Error("correct password rejected")
	}
	if VerifyPassword(hash, "wrong") {
		t.Error("wrong password accepted")
	}
}

func TestVerifyRejectsGarbageHash(t *testing.T) {
	if VerifyPassword("", "anything") {
		t.Error("empty hash accepted a password")
	}
	if VerifyPassword("not-a-bcrypt-hash", "anything") {
		t.Error("malformed hash accepted a password")
	}
}

func TestHashRejectsEmptyPassword(t *testing.T) {
	if _, err := HashPassword(""); err == nil {
		t.Error("expected an error for an empty password")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/auth/`
Expected: FAIL — undefined: `HashPassword`.

- [ ] **Step 3: Write the implementation**

```bash
go get golang.org/x/crypto/bcrypt golang.org/x/term
```

Create `internal/auth/password.go`:

```go
// Package auth handles the single-user application login and sessions.
package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost of 12 is roughly 250ms on current hardware: slow enough to make
// offline cracking of the stored hash expensive, fast enough for a login.
const bcryptCost = 12

// HashPassword returns an encoded bcrypt hash suitable for MAZECD_PASSWORD_HASH.
func HashPassword(password string) (string, error) {
	if password == "" {
		return "", errors.New("password is empty")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// VerifyPassword reports whether password matches the encoded hash. It is
// constant-time with respect to the password and never panics on a bad hash.
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/auth/ -v`
Expected: PASS.

- [ ] **Step 5: Add the `hash` subcommand**

Create `cmd/mazecd/main.go`:

```go
// Command mazecd serves the MazeCD API and PWA.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/amaze-labs/MazeCD/internal/auth"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash" {
		if err := runHash(); err != nil {
			fmt.Fprintln(os.Stderr, "mazecd hash:", err)
			os.Exit(1)
		}
		return
	}
	fmt.Fprintln(os.Stderr, "usage: mazecd [hash]")
	os.Exit(2)
}

// runHash prints a bcrypt hash for a password read from the terminal or stdin,
// for use as MAZECD_PASSWORD_HASH.
func runHash() error {
	password, err := readPassword()
	if err != nil {
		return err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	fmt.Println(hash)
	return nil
}

func readPassword() (string, error) {
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		fmt.Fprint(os.Stderr, "Password: ")
		b, err := term.ReadPassword(fd)
		fmt.Fprintln(os.Stderr)
		return string(b), err
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimRight(line, "\r\n"), err
}
```

- [ ] **Step 6: Verify the subcommand end to end**

Run: `printf 'hunter2\n' | go run ./cmd/mazecd hash`
Expected: a single line starting with `$2a$12$`.

- [ ] **Step 7: Commit**

```bash
git add internal/auth/password.go internal/auth/password_test.go cmd/mazecd/main.go go.mod go.sum
git commit -m "feat(auth): bcrypt password hashing and mazecd hash subcommand"
```

---

### Task 3: Sessions and the sliding-renewal middleware

**Files:**
- Create: `internal/auth/session.go`
- Test: `internal/auth/session_test.go`

**Interfaces:**
- Consumes: nothing.
- Produces: `auth.NewSessions(key []byte) (*Sessions, error)`, `(*Sessions).Issue(now time.Time) (token string, expires time.Time)`, `(*Sessions).Verify(token string, now time.Time) (issuedAt time.Time, ok bool)`, `(*Sessions).SetCookie(w http.ResponseWriter, token string, expires time.Time)`, `(*Sessions).ClearCookie(w http.ResponseWriter)`, `(*Sessions).Require(next http.Handler) http.Handler`, constants `auth.CookieName`, `auth.SessionTTL`, `auth.RenewAfter`.

The token is `<base64url(iat|exp)>.<base64url(hmac-sha256)>` — an opaque signed token rather than a JWT: no algorithm negotiation to get wrong and no dependency.

- [ ] **Step 1: Write the failing test**

Create `internal/auth/session_test.go`:

```go
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/auth/ -run Session -v`
Expected: FAIL — undefined: `NewSessions`.

- [ ] **Step 3: Write the implementation**

Create `internal/auth/session.go`:

```go
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
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}
		now := time.Now()
		iat, ok := s.Verify(c.Value, now)
		if !ok {
			s.ClearCookie(w)
			http.Error(w, "unauthenticated", http.StatusUnauthorized)
			return
		}
		if now.Sub(iat) > RenewAfter {
			tok, exp := s.Issue(now)
			s.SetCookie(w, tok, exp)
		}
		next.ServeHTTP(w, r)
	})
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/auth/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/auth/session.go internal/auth/session_test.go
git commit -m "feat(auth): signed sessions with sliding renewal middleware"
```

---

### Task 4: Login, logout and rate limiting

**Files:**
- Create: `internal/auth/ratelimit.go`, `internal/auth/handler.go`
- Test: `internal/auth/ratelimit_test.go`, `internal/auth/handler_test.go`

**Interfaces:**
- Consumes: `HashPassword`/`VerifyPassword` (Task 2), `*Sessions` (Task 3).
- Produces: `auth.NewLimiter(max int, window time.Duration) *Limiter`, `(*Limiter).Allow(key string, now time.Time) bool`, `auth.NewHandler(passwordHash string, sessions *Sessions) *Handler`, `(*Handler).Mount(mux *http.ServeMux)` registering `POST /api/auth/login`, `POST /api/auth/logout` and `GET /api/auth/me`.

- [ ] **Step 1: Write the failing limiter test**

Create `internal/auth/ratelimit_test.go`:

```go
package auth

import (
	"testing"
	"time"
)

func TestLimiterAllowsUpToMaxThenBlocks(t *testing.T) {
	l := NewLimiter(5, 15*time.Minute)
	now := time.Now()
	for i := 0; i < 5; i++ {
		if !l.Allow("1.2.3.4", now) {
			t.Fatalf("attempt %d was blocked", i+1)
		}
	}
	if l.Allow("1.2.3.4", now) {
		t.Error("6th attempt was allowed")
	}
	if !l.Allow("5.6.7.8", now) {
		t.Error("a different client was blocked")
	}
	if !l.Allow("1.2.3.4", now.Add(16*time.Minute)) {
		t.Error("still blocked after the window elapsed")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./internal/auth/ -run Limiter`
Expected: FAIL — undefined: `NewLimiter`.

- [ ] **Step 3: Implement the limiter**

Create `internal/auth/ratelimit.go`:

```go
package auth

import (
	"sync"
	"time"
)

// Limiter is a fixed-window attempt counter keyed by client.
// ponytail: one mutex and a map; the login endpoint of a single-user app will
// never see the contention that would justify anything sharded.
type Limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string][]time.Time
}

// NewLimiter allows max attempts per key per window.
func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{max: max, window: window, hits: map[string][]time.Time{}}
}

// Allow records an attempt and reports whether it is within the limit.
func (l *Limiter) Allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	cutoff := now.Add(-l.window)
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}
```

- [ ] **Step 4: Write the failing handler test**

Create `internal/auth/handler_test.go`:

```go
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
```

- [ ] **Step 5: Run it to verify it fails**

Run: `go test ./internal/auth/ -run 'Login|Me|Logout'`
Expected: FAIL — undefined: `NewHandler`.

- [ ] **Step 6: Implement the handler**

Create `internal/auth/handler.go`:

```go
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
```

- [ ] **Step 7: Run the whole auth package**

Run: `go test ./internal/auth/ -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add internal/auth
git commit -m "feat(auth): login, logout and per-IP login rate limiting"
```

---

### Task 5: Per-instance ArgoCD client and registry

**Files:**
- Create: `internal/argocd/client.go`
- Test: `internal/argocd/client_test.go`

**Interfaces:**
- Consumes: `config.Instance`, `*config.Config` (Task 1).
- Produces: `argocd.NewClient(inst config.Instance) (*Client, error)`, `(*Client).Instance() config.Instance`, `(*Client).Get(ctx context.Context, path string, out any) error` where `path` is relative to `/api/v1`, `argocd.NewRegistry(cfg *config.Config) (*Registry, error)`, `(*Registry).Get(name string) (*Client, bool)`, `(*Registry).All() []*Client`.

- [ ] **Step 1: Write the failing test**

Create `internal/argocd/client_test.go`:

```go
package argocd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"os"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

func TestClientGetInjectsToken(t *testing.T) {
	var gotAuth, gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"loggedIn":true}`))
	}))
	defer srv.Close()

	c, err := NewClient(config.Instance{Name: "dev", URL: srv.URL, Token: "tok123"})
	if err != nil {
		t.Fatal(err)
	}
	var out struct{ LoggedIn bool }
	if err := c.Get(context.Background(), "session/userinfo", &out); err != nil {
		t.Fatalf("Get: %v", err)
	}
	if gotAuth != "Bearer tok123" {
		t.Errorf("Authorization = %q, want Bearer tok123", gotAuth)
	}
	if gotPath != "/api/v1/session/userinfo" {
		t.Errorf("path = %q, want /api/v1/session/userinfo", gotPath)
	}
	if !out.LoggedIn {
		t.Error("response not decoded")
	}
}

func TestClientGetReportsHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "no permission", http.StatusForbidden)
	}))
	defer srv.Close()

	c, err := NewClient(config.Instance{Name: "dev", URL: srv.URL, Token: "t"})
	if err != nil {
		t.Fatal(err)
	}
	var out any
	err = c.Get(context.Background(), "applications", &out)
	if err == nil {
		t.Fatal("expected an error for 403")
	}
	var se *StatusError
	if !errorsAs(err, &se) || se.Code != http.StatusForbidden {
		t.Fatalf("want StatusError 403, got %#v", err)
	}
}

func TestNewClientRejectsUnreadableCA(t *testing.T) {
	_, err := NewClient(config.Instance{
		Name:   "dev",
		URL:    "https://x.internal",
		Token:  "t",
		CACert: filepath.Join(t.TempDir(), "missing.pem"),
	})
	if err == nil {
		t.Error("expected an error for a missing CA file")
	}
}

func TestNewClientAcceptsCAFile(t *testing.T) {
	// A syntactically valid but unrelated PEM is enough: we assert it is loaded.
	pem := filepath.Join(t.TempDir(), "ca.pem")
	if err := os.WriteFile(pem, []byte(testCAPEM), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewClient(config.Instance{Name: "dev", URL: "https://x.internal", Token: "t", CACert: pem}); err != nil {
		t.Fatalf("NewClient with a valid CA: %v", err)
	}
}

func TestRegistryLookup(t *testing.T) {
	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: "https://p.internal", Token: "a"},
		{Name: "dev", URL: "https://d.internal", Token: "b"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(reg.All()) != 2 {
		t.Fatalf("All() = %d clients, want 2", len(reg.All()))
	}
	if reg.All()[0].Instance().Name != "prod" {
		t.Error("All() must preserve config order")
	}
	if _, ok := reg.Get("dev"); !ok {
		t.Error("dev not found")
	}
	if _, ok := reg.Get("staging"); ok {
		t.Error("unknown instance found")
	}
}
```

Append to the same file the helper and the fixture. Add `"errors"` to the test imports.

```go
func errorsAs(err error, target any) bool { return errors.As(err, target) }

// testCAPEM is a self-signed certificate used only to prove that a CA file is
// parsed; it is never trusted for a real connection. Expires 2036.
const testCAPEM = `-----BEGIN CERTIFICATE-----
MIIDDTCCAfWgAwIBAgIUYqOeDD+Cyw1xqsyIbVzxj3qnOVwwDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLbWF6ZWNkLXRlc3QwHhcNMjYwOTExMDkyNDU4WhcNMzYw
OTA4MDkyNDU4WjAWMRQwEgYDVQQDDAttYXplY2QtdGVzdDCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAKbU2m9EEWXYY008W7Aoe4CKh+/b2WgCnmsaLGqM
TArmtR9qBMlb4GZRerGoIK5p0d24zJxDOPX0Nww30/ORHlIJLQTzVv2KbrcXAXs8
peslJIgWDUv0zcX7jjr1vxZ9LXLVHPogd39Lwa0rXPbOCFgdFYwYCS7th64JlsMj
5UKJKrXIqlGyRwKMccjmEPC6eKuLnZmphl9hGdM5CajReAXxOSy6h4mEKpsk77uE
BrvOSAoaYpIXIWUSmfQx8Tyqtqa3lTWsJScRSva0WrtcqoTSUx+2YMxEYtow3s4K
yFoh61I5js9m28jov+MXBbrhGnpniF10GcFe1Zo2FuysZScCAwEAAaNTMFEwHQYD
VR0OBBYEFJbh+h2fFnNOJAjQq1Pgqs4ROHT2MB8GA1UdIwQYMBaAFJbh+h2fFnNO
JAjQq1Pgqs4ROHT2MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB
AIWDcejIq3/1+30/+WG0Ba20Qc78scpnwBObCjHxKA6KRJ5gYGIBvLA2muscUiB1
d8ZHkSs1JAr0TJUIK8ypc2y2sUpIL9kcGPo9O/K6VI8JwQoYO1q07zwGMduEgdEj
Am1zGKSUXdzGYZ/wpHGjDi6usepi0viAJUlzFRoWK/+0KSL/0DxZLpKTWgIOKOdl
XxXYyG1Eq8VkfqXBgDOcap0YY31NowbCMFoM0RSK85RN3tqItPR2nYhVIghm/Lk/
iGpauKmYiSqm5+8+i2TagtxMxLZv9nlT3IaJYMybBsMfpvuLa5SbSIipZRRgD36L
zT1RMiJqq8+WKp3qnT9jKI0=
-----END CERTIFICATE-----
`
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/argocd/`
Expected: FAIL — undefined: `NewClient`.

- [ ] **Step 3: Write the implementation**

Create `internal/argocd/client.go`:

```go
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
	inst config.Instance
	base *url.URL
	http *http.Client
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
	return &Client{
		inst: inst,
		base: base,
		// No global client timeout: log streaming is a long-lived response.
		// Callers bound their own requests with a context.
		http: &http.Client{Transport: transport},
	}, nil
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `go test ./internal/argocd/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/argocd
git commit -m "feat(argocd): per-instance authenticated client and registry"
```

---

### Task 6: Streaming-safe reverse proxy

**Files:**
- Create: `internal/argocd/proxy.go`
- Modify: `internal/argocd/client.go` (add the `proxy` field and its constructor wiring)
- Test: `internal/argocd/proxy_test.go`

**Interfaces:**
- Consumes: `*Registry`, `*Client` (Task 5).
- Produces: `(*Registry).ProxyHandler() http.Handler`, to be mounted on the pattern `/api/i/{instance}/{rest...}`; `(*Client).Proxy() http.Handler`.

This is the task that makes sync, refresh, rollback, delete, events, manifests and log streaming work without endpoint-specific code.

- [ ] **Step 1: Write the failing test**

Create `internal/argocd/proxy_test.go`:

```go
package argocd

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

// mount wires the proxy exactly as the server does, so the test exercises the
// real routing pattern.
func mount(reg *Registry) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/api/i/{instance}/{rest...}", reg.ProxyHandler())
	return mux
}

func TestProxyRewritesPathAndInjectsToken(t *testing.T) {
	var got *http.Request
	var body string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.Clone(r.Context())
		b, _ := io.ReadAll(r.Body)
		body = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer upstream.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: upstream.URL, Token: "prodtok"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest("POST", "/api/i/prod/applications/web/sync?appNamespace=argocd", strings.NewReader(`{"prune":true}`))
	req.Header.Set("Authorization", "Bearer attacker-supplied")
	req.AddCookie(&http.Cookie{Name: "mazecd_session", Value: "secret"})
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got.URL.Path != "/api/v1/applications/web/sync" {
		t.Errorf("upstream path = %q, want /api/v1/applications/web/sync", got.URL.Path)
	}
	if got.URL.RawQuery != "appNamespace=argocd" {
		t.Errorf("query = %q, want appNamespace=argocd", got.URL.RawQuery)
	}
	if got.Header.Get("Authorization") != "Bearer prodtok" {
		t.Errorf("Authorization = %q, want the instance token", got.Header.Get("Authorization"))
	}
	if got.Header.Get("Cookie") != "" {
		t.Error("the MazeCD session cookie was forwarded to ArgoCD")
	}
	if body != `{"prune":true}` {
		t.Errorf("body = %q, want the request body forwarded unchanged", body)
	}
}

func TestProxyUnknownInstance(t *testing.T) {
	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: "https://p.internal", Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/staging/applications", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestProxyUnreachableUpstreamReturns502(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	url := dead.URL
	dead.Close() // nothing is listening any more

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: url, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	mount(reg).ServeHTTP(rec, httptest.NewRequest("GET", "/api/i/prod/applications", nil))
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "prod") {
		t.Errorf("error body %q does not name the instance", rec.Body.String())
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/argocd/ -run Proxy`
Expected: FAIL — `reg.ProxyHandler` undefined.

- [ ] **Step 3: Write the implementation**

Create `internal/argocd/proxy.go`:

```go
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
```

- [ ] **Step 4: Wire the proxy into the client**

In `internal/argocd/client.go`, add the field and build it in `NewClient`:

```go
// Client is an authenticated connection to one ArgoCD instance.
type Client struct {
	inst  config.Instance
	base  *url.URL
	http  *http.Client
	proxy *httputil.ReverseProxy
}
```

At the end of `NewClient`, replace the `return` with:

```go
	c := &Client{
		inst: inst,
		base: base,
		http: &http.Client{Transport: transport},
	}
	c.proxy = newProxy(c)
	return c, nil
```

Add `"net/http/httputil"` to the imports of `client.go`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./internal/argocd/ -v`
Expected: PASS, including the three proxy tests.

- [ ] **Step 6: Commit**

```bash
git add internal/argocd
git commit -m "feat(argocd): authenticated streaming reverse proxy per instance"
```

---

### Task 7: Aggregated application list

**Files:**
- Create: `internal/argocd/apps.go`
- Test: `internal/argocd/apps_test.go`

**Interfaces:**
- Consumes: `*Registry`, `(*Client).Get`, `instanceTimeout` (Task 5).
- Produces: `argocd.App`, `argocd.InstanceError`, `argocd.AppsResponse`, `(*Registry).Apps(ctx context.Context) AppsResponse`.

- [ ] **Step 1: Write the failing test**

Create `internal/argocd/apps_test.go`:

```go
package argocd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

const appListJSON = `{"items":[
 {"metadata":{"name":"web","namespace":"argocd"},
  "spec":{"project":"default","destination":{"server":"https://kubernetes.default.svc","namespace":"web-prod"}},
  "status":{"health":{"status":"Degraded"},"sync":{"status":"OutOfSync","revision":"abc1234"},
            "operationState":{"phase":"Running"}}},
 {"metadata":{"name":"api","namespace":"argocd"},
  "spec":{"project":"default","destination":{"server":"https://kubernetes.default.svc","namespace":"api-prod"}},
  "status":{"health":{"status":"Healthy"},"sync":{"status":"Synced","revision":"def5678"}}}
]}`

func TestAppsAggregatesAndTagsInstance(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/applications" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(appListJSON))
	}))
	defer up.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: up.URL, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	res := reg.Apps(context.Background())
	if len(res.Errors) != 0 {
		t.Fatalf("unexpected errors: %+v", res.Errors)
	}
	if len(res.Apps) != 2 {
		t.Fatalf("got %d apps, want 2", len(res.Apps))
	}
	// Deterministic order: instance then name.
	if res.Apps[0].Name != "api" || res.Apps[1].Name != "web" {
		t.Errorf("apps not sorted by name: %+v", res.Apps)
	}
	web := res.Apps[1]
	if web.Instance != "prod" {
		t.Errorf("Instance = %q, want prod", web.Instance)
	}
	if web.Health != "Degraded" || web.Sync != "OutOfSync" {
		t.Errorf("status = %s/%s, want Degraded/OutOfSync", web.Health, web.Sync)
	}
	if web.Revision != "abc1234" || web.DestNamespace != "web-prod" || web.Project != "default" {
		t.Errorf("unexpected fields: %+v", web)
	}
	if web.OperationPhase != "Running" {
		t.Errorf("OperationPhase = %q, want Running", web.OperationPhase)
	}
	if res.Apps[0].OperationPhase != "" {
		t.Errorf("OperationPhase = %q, want empty when there is no operation", res.Apps[0].OperationPhase)
	}
}

func TestAppsReturnsPartialResultsOnFailure(t *testing.T) {
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(appListJSON))
	}))
	defer good.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer bad.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: good.URL, Token: "t"},
		{Name: "staging", URL: bad.URL, Token: "t"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	res := reg.Apps(context.Background())
	if len(res.Apps) != 2 {
		t.Errorf("got %d apps, want the 2 from the healthy instance", len(res.Apps))
	}
	if len(res.Errors) != 1 || res.Errors[0].Instance != "staging" {
		t.Fatalf("want one error for staging, got %+v", res.Errors)
	}
	if res.Errors[0].Message == "" {
		t.Error("error message is empty")
	}
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/argocd/ -run Apps`
Expected: FAIL — `reg.Apps` undefined.

- [ ] **Step 3: Write the implementation**

Create `internal/argocd/apps.go`:

```go
package argocd

import (
	"context"
	"sort"
	"sync"
)

// App is the subset of an ArgoCD Application the list view renders.
type App struct {
	Instance       string `json:"instance"`
	Name           string `json:"name"`
	Namespace      string `json:"namespace"` // the Application's own namespace
	Project        string `json:"project"`
	DestServer     string `json:"destServer"`
	DestNamespace  string `json:"destNamespace"`
	Health         string `json:"health"`
	Sync           string `json:"sync"`
	Revision       string `json:"revision"`
	OperationPhase string `json:"operationPhase,omitempty"`
}

// InstanceError reports one instance that could not be queried.
type InstanceError struct {
	Instance string `json:"instance"`
	Message  string `json:"message"`
}

// AppsResponse is always returned with HTTP 200: a single unreachable instance
// must not blank the whole list.
type AppsResponse struct {
	Apps   []App           `json:"apps"`
	Errors []InstanceError `json:"errors"`
}

// applicationList mirrors only the ArgoCD fields used above.
type applicationList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Spec struct {
			Project     string `json:"project"`
			Destination struct {
				Server    string `json:"server"`
				Namespace string `json:"namespace"`
			} `json:"destination"`
		} `json:"spec"`
		Status struct {
			Health struct {
				Status string `json:"status"`
			} `json:"health"`
			Sync struct {
				Status   string `json:"status"`
				Revision string `json:"revision"`
			} `json:"sync"`
			OperationState *struct {
				Phase string `json:"phase"`
			} `json:"operationState"`
		} `json:"status"`
	} `json:"items"`
}

// Apps queries every instance in parallel and merges the results.
func (r *Registry) Apps(ctx context.Context) AppsResponse {
	var (
		mu   sync.Mutex
		res  = AppsResponse{Apps: []App{}, Errors: []InstanceError{}}
		wg   sync.WaitGroup
	)
	for _, c := range r.All() {
		wg.Add(1)
		go func(c *Client) {
			defer wg.Done()
			reqCtx, cancel := context.WithTimeout(ctx, instanceTimeout)
			defer cancel()

			var list applicationList
			err := c.Get(reqCtx, "applications", &list)

			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				res.Errors = append(res.Errors, InstanceError{
					Instance: c.Instance().Name,
					Message:  err.Error(),
				})
				return
			}
			for _, it := range list.Items {
				app := App{
					Instance:      c.Instance().Name,
					Name:          it.Metadata.Name,
					Namespace:     it.Metadata.Namespace,
					Project:       it.Spec.Project,
					DestServer:    it.Spec.Destination.Server,
					DestNamespace: it.Spec.Destination.Namespace,
					Health:        it.Status.Health.Status,
					Sync:          it.Status.Sync.Status,
					Revision:      it.Status.Sync.Revision,
				}
				if it.Status.OperationState != nil {
					app.OperationPhase = it.Status.OperationState.Phase
				}
				res.Apps = append(res.Apps, app)
			}
		}(c)
	}
	wg.Wait()

	sort.Slice(res.Apps, func(i, j int) bool {
		if res.Apps[i].Instance != res.Apps[j].Instance {
			return res.Apps[i].Instance < res.Apps[j].Instance
		}
		return res.Apps[i].Name < res.Apps[j].Name
	})
	sort.Slice(res.Errors, func(i, j int) bool { return res.Errors[i].Instance < res.Errors[j].Instance })
	return res
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/argocd/ -v -race`
Expected: PASS with no race reports.

- [ ] **Step 5: Commit**

```bash
git add internal/argocd
git commit -m "feat(argocd): fault-tolerant aggregated application list"
```

---

### Task 8: Instance health and token validity

**Files:**
- Create: `internal/argocd/health.go`
- Test: `internal/argocd/health_test.go`

**Interfaces:**
- Consumes: `*Registry`, `(*Client).Get`, `StatusError`, `instanceTimeout` (Task 5).
- Produces: `argocd.InstanceInfo{Name, Color string, Production, Reachable bool, TokenValid bool, Error string}`, `(*Registry).Instances(ctx context.Context) []InstanceInfo`.

- [ ] **Step 1: Write the failing test**

Create `internal/argocd/health_test.go`:

```go
package argocd

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/config"
)

func TestInstancesReportsHealthWithoutLeakingTokens(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/session/userinfo" {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"loggedIn":true,"username":"mazecd"}`))
	}))
	defer ok.Close()
	revoked := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "token revoked", http.StatusUnauthorized)
	}))
	defer revoked.Close()

	reg, err := NewRegistry(&config.Config{Instances: []config.Instance{
		{Name: "prod", URL: ok.URL, Token: "supersecret", Color: "#ef4444", Production: true},
		{Name: "dev", URL: revoked.URL, Token: "othersecret", Color: "#3b82f6"},
	}})
	if err != nil {
		t.Fatal(err)
	}

	got := reg.Instances(context.Background())
	if len(got) != 2 {
		t.Fatalf("got %d instances, want 2", len(got))
	}
	prod, dev := got[0], got[1]
	if prod.Name != "prod" || !prod.Reachable || !prod.TokenValid || prod.Error != "" {
		t.Errorf("prod = %+v, want reachable with a valid token", prod)
	}
	if !prod.Production || prod.Color != "#ef4444" {
		t.Errorf("prod metadata not surfaced: %+v", prod)
	}
	if dev.TokenValid {
		t.Error("dev token reported valid despite a 401")
	}
	if dev.Error == "" {
		t.Error("dev has no error message")
	}
	for _, in := range got {
		if strings.Contains(in.Error, "supersecret") || strings.Contains(in.Error, "othersecret") {
			t.Fatal("an instance token leaked into the response")
		}
	}
}
```

The imports are `context`, `net/http`, `net/http/httptest`, `strings`, `testing` and the `config` package.

- [ ] **Step 2: Run the test to verify it fails**

Run: `go test ./internal/argocd/ -run Instances`
Expected: FAIL — `reg.Instances` undefined.

- [ ] **Step 3: Write the implementation**

Create `internal/argocd/health.go`:

```go
package argocd

import (
	"context"
	"errors"
	"net/http"
	"sync"
)

// InstanceInfo is what the browser is allowed to know about an instance:
// never the token.
type InstanceInfo struct {
	Name       string `json:"name"`
	Color      string `json:"color"`
	Production bool   `json:"production"`
	URL        string `json:"url"`
	Reachable  bool   `json:"reachable"`
	TokenValid bool   `json:"tokenValid"`
	Error      string `json:"error,omitempty"`
}

// Instances probes every instance in parallel, in configuration order.
func (r *Registry) Instances(ctx context.Context) []InstanceInfo {
	clients := r.All()
	out := make([]InstanceInfo, len(clients))
	var wg sync.WaitGroup
	for i, c := range clients {
		wg.Add(1)
		go func(i int, c *Client) {
			defer wg.Done()
			inst := c.Instance()
			info := InstanceInfo{
				Name:       inst.Name,
				Color:      inst.Color,
				Production: inst.Production,
				URL:        inst.URL,
			}
			reqCtx, cancel := context.WithTimeout(ctx, instanceTimeout)
			defer cancel()

			var userinfo struct{ LoggedIn bool `json:"loggedIn"` }
			err := c.Get(reqCtx, "session/userinfo", &userinfo)
			switch {
			case err == nil && userinfo.LoggedIn:
				info.Reachable, info.TokenValid = true, true
			case err == nil:
				info.Reachable = true
				info.Error = "the instance token is not accepted"
			default:
				var se *StatusError
				if errors.As(err, &se) {
					// A reply, even a rejecting one, means the server is up.
					info.Reachable = true
					if se.Code == http.StatusUnauthorized || se.Code == http.StatusForbidden {
						info.Error = "the instance token is invalid or revoked"
					} else {
						info.Error = se.Error()
					}
				} else {
					info.Error = err.Error()
				}
			}
			out[i] = info
		}(i, c)
	}
	wg.Wait()
	return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./internal/argocd/ -v -race`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/argocd
git commit -m "feat(argocd): instance reachability and token validity probe"
```

---

### Task 9: Static serving, route table and server startup

**Files:**
- Create: `internal/web/static.go`, `internal/server/server.go`
- Modify: `cmd/mazecd/main.go` (add the serve path next to `hash`)
- Test: `internal/web/static_test.go`, `internal/server/server_test.go`

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: `web.Handler() (http.Handler, error)`, `server.Options{Config, Registry, Sessions, PasswordHash, Version, Static}`, `server.New(opts Options) http.Handler`.

- [ ] **Step 1: Write the failing static test**

Create `internal/web/static_test.go`:

```go
package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":            {Data: []byte("<!doctype html>shell")},
		"manifest.webmanifest":  {Data: []byte("{}")},
		"sw.js":                 {Data: []byte("// service worker")},
		"assets/app-abc123.js":  {Data: []byte("console.log(1)")},
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./internal/web/`
Expected: FAIL — undefined: `handlerFor`.

- [ ] **Step 3: Implement static serving**

Create `internal/web/static.go`:

```go
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
		} else {
			// index.html, the service worker and the manifest must never be
			// cached, or a released build can be shadowed by an old client.
			w.Header().Set("Cache-Control", "no-store")
		}
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `go test ./internal/web/ -v`
Expected: PASS.

- [ ] **Step 5: Write the failing server test**

Create `internal/server/server_test.go`:

```go
package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amaze-labs/MazeCD/internal/argocd"
	"github.com/amaze-labs/MazeCD/internal/auth"
	"github.com/amaze-labs/MazeCD/internal/config"
)

func testServer(t *testing.T) (http.Handler, *auth.Sessions) {
	t.Helper()
	cfg := &config.Config{Instances: []config.Instance{
		{Name: "prod", URL: "https://p.internal", Token: "t", Color: "#ef4444"},
	}}
	reg, err := argocd.NewRegistry(cfg)
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := auth.NewSessions([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	hash, err := auth.HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	h := New(Options{
		Registry:     reg,
		Sessions:     sessions,
		PasswordHash: hash,
		Version:      "test-1",
		Static:       http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("shell")) }),
	})
	return h, sessions
}

func TestProtectedRoutesRequireSession(t *testing.T) {
	h, _ := testServer(t)
	for _, path := range []string{"/api/apps", "/api/instances", "/api/i/prod/applications"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: status = %d, want 401", path, rec.Code)
		}
	}
}

func TestVersionIsPublicAndUncached(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/version", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "test-1") {
		t.Errorf("body = %q, want the build version", rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestAPIResponsesAreUncached(t *testing.T) {
	h, sessions := testServer(t)
	tok, _ := sessions.Issue(timeNow())
	req := httptest.NewRequest("GET", "/api/instances", nil)
	req.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
}

func TestUnknownAPIRouteIsNotTheShell(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/nope", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "shell") {
		t.Error("an unknown API route returned the app shell")
	}
}

func TestClientRouteServesShell(t *testing.T) {
	h, _ := testServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/apps/prod/web", nil))
	if rec.Body.String() != "shell" {
		t.Errorf("body = %q, want the app shell", rec.Body.String())
	}
}
```

Add `import "time"` and `func timeNow() time.Time { return time.Now() }` at the bottom of the test file.

- [ ] **Step 6: Run it to verify it fails**

Run: `go test ./internal/server/`
Expected: FAIL — undefined: `New`, `Options`.

- [ ] **Step 7: Implement the route table**

Create `internal/server/server.go`:

```go
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
```

- [ ] **Step 8: Run it to verify it passes**

Run: `go test ./internal/server/ -v`
Expected: PASS.

- [ ] **Step 9: Add the serve path to main**

Replace the `main` function in `cmd/mazecd/main.go` and add `runServe`:

```go
func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "hash":
			if err := runHash(); err != nil {
				fmt.Fprintln(os.Stderr, "mazecd hash:", err)
				os.Exit(1)
			}
			return
		case "serve":
			// default
		default:
			fmt.Fprintln(os.Stderr, "usage: mazecd [serve|hash]")
			os.Exit(2)
		}
	}
	if err := runServe(); err != nil {
		fmt.Fprintln(os.Stderr, "mazecd:", err)
		os.Exit(1)
	}
}

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

func runServe() error {
	cfgPath := envOr("MAZECD_CONFIG", "/etc/mazecd/config.yaml")
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}
	passwordHash := os.Getenv("MAZECD_PASSWORD_HASH")
	if passwordHash == "" {
		return errors.New("MAZECD_PASSWORD_HASH is not set; generate one with: mazecd hash")
	}
	rawKey := os.Getenv("MAZECD_SESSION_KEY")
	if rawKey == "" {
		return errors.New("MAZECD_SESSION_KEY is not set; generate one with: openssl rand -base64 32")
	}
	key, err := base64.StdEncoding.DecodeString(rawKey)
	if err != nil {
		return fmt.Errorf("MAZECD_SESSION_KEY must be base64: %w", err)
	}
	sessions, err := auth.NewSessions(key)
	if err != nil {
		return err
	}
	registry, err := argocd.NewRegistry(cfg)
	if err != nil {
		return err
	}
	static, err := web.Handler()
	if err != nil {
		return err
	}

	handler := server.New(server.Options{
		Registry:     registry,
		Sessions:     sessions,
		PasswordHash: passwordHash,
		Version:      version,
		Static:       static,
	})

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No WriteTimeout: pod log streaming is a long-lived response.
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	names := make([]string, 0, len(cfg.Instances))
	for _, i := range cfg.Instances {
		names = append(names, i.Name)
	}
	slog.Info("mazecd starting", "version", version, "listen", cfg.Listen, "instances", names)

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

Imports for `cmd/mazecd/main.go`:

```go
import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/amaze-labs/MazeCD/internal/argocd"
	"github.com/amaze-labs/MazeCD/internal/auth"
	"github.com/amaze-labs/MazeCD/internal/config"
	"github.com/amaze-labs/MazeCD/internal/server"
	"github.com/amaze-labs/MazeCD/internal/web"
)
```

- [ ] **Step 10: Verify the whole backend builds and passes**

```bash
go build ./... && go vet ./... && go test ./... -race
```

Expected: build succeeds, all tests pass.

- [ ] **Step 11: Verify startup fails loudly without configuration**

Run: `go run ./cmd/mazecd serve`
Expected: exit 1 with `read config: open /etc/mazecd/config.yaml: no such file or directory`.

- [ ] **Step 12: Commit**

```bash
git add internal/web internal/server cmd/mazecd
git commit -m "feat(server): route table, embedded PWA serving and startup"
```

---

### Task 10: Frontend scaffold, API client and sync mapping

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/index.css`, `web/src/api/client.ts`, `web/src/api/types.ts`, `web/src/api/queries.ts`, `web/src/lib/sync.ts`, `web/src/lib/status.ts`
- Test: `web/src/lib/sync.test.ts`

**Interfaces:**
- Consumes: the backend routes from Task 9.
- Produces: `api.get/post/del`, `argoPath(instance, path)`, `ApiError`, `setUnauthenticatedHandler(fn)`; types `App`, `AppsResponse`, `InstanceInfo`, `ResourceNode`, `ResourceTree`, `AppDetail`; hooks `useApps()`, `useInstances()`, `useAppDetail(instance, name)`, `useResourceTree(instance, name)`; `buildSyncRequest(options: SyncOptions)`; `statusColor(kind, value)`.

`buildSyncRequest` is the one piece of frontend logic that can cause real damage if wrong, so it is written test-first.

- [ ] **Step 1: Scaffold the project**

```bash
npm create vite@latest web -- --template react-ts
cd web
npm install @tanstack/react-query react-router-dom diff
npm install -D @tailwindcss/vite tailwindcss vite-plugin-pwa vitest
rm -f src/App.tsx src/App.css public/vite.svg src/assets/react.svg
```

- [ ] **Step 2: Configure Vite**

Replace `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': src/lib/update.ts drives the
      // reload so an operation in flight is never interrupted.
      registerType: 'prompt',
      filename: 'sw.js',
      manifest: {
        name: 'MazeCD',
        short_name: 'MazeCD',
        description: 'Multi-instance ArgoCD control',
        theme_color: '#0b0e14',
        background_color: '#0b0e14',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        // ArgoCD state is never cached: a stale sync status shown as current
        // is an operational hazard, not a convenience.
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.MAZECD_VERSION ?? 'dev'),
  },
  build: {
    outDir: '../internal/web/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },
  },
  test: { environment: 'node' },
})
```

Add to `web/tsconfig.app.json` under `compilerOptions`:

```json
"types": ["vite/client", "vite-plugin-pwa/client", "vitest/globals"]
```

Create `web/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
declare const __BUILD_VERSION__: string
```

Add to `web/package.json` scripts:

```json
"test": "vitest run",
"build": "tsc -b && vite build"
```

- [ ] **Step 3: Write the failing sync-mapping test**

Create `web/src/lib/sync.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { buildSyncRequest, defaultSyncOptions } from './sync'

describe('buildSyncRequest', () => {
  test('a plain sync defaults the revision to HEAD and runs hooks', () => {
    const req = buildSyncRequest(defaultSyncOptions())
    expect(req.revision).toBe('HEAD')
    expect(req.prune).toBe(false)
    expect(req.dryRun).toBe(false)
    expect(req.strategy).toEqual({ hook: { force: false } })
    expect(req.syncOptions).toBeUndefined()
    expect(req.resources).toBeUndefined()
    expect(req.retryStrategy).toBeUndefined()
  })

  test('prune and dryRun map to their own fields', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), prune: true, dryRun: true })
    expect(req.prune).toBe(true)
    expect(req.dryRun).toBe(true)
  })

  test('force lands inside the selected strategy, not at the top level', () => {
    const withHooks = buildSyncRequest({ ...defaultSyncOptions(), force: true })
    expect(withHooks.strategy).toEqual({ hook: { force: true } })
    expect('force' in withHooks).toBe(false)

    const skipping = buildSyncRequest({ ...defaultSyncOptions(), force: true, skipHooks: true })
    expect(skipping.strategy).toEqual({ apply: { force: true } })
  })

  test('replace is a syncOptions item, not a boolean', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), replace: true })
    expect(req.syncOptions).toEqual({ items: ['Replace=true'] })
  })

  test('selected resources are sent as references', () => {
    const req = buildSyncRequest({
      ...defaultSyncOptions(),
      resources: [{ group: 'apps', kind: 'Deployment', name: 'web', namespace: 'web-prod' }],
    })
    expect(req.resources).toEqual([
      { group: 'apps', kind: 'Deployment', name: 'web', namespace: 'web-prod' },
    ])
  })

  test('an explicit revision is preserved', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), revision: 'v1.4.2' })
    expect(req.revision).toBe('v1.4.2')
  })

  test('retry adds a bounded backoff strategy', () => {
    const req = buildSyncRequest({ ...defaultSyncOptions(), retry: true })
    expect(req.retryStrategy).toEqual({
      limit: 2,
      backoff: { duration: '5s', factor: 2, maxDuration: '3m' },
    })
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — cannot resolve `./sync`.

- [ ] **Step 5: Implement the mapping**

Create `web/src/lib/sync.ts`:

```ts
import type { ResourceRef } from '../api/types'

export type SyncOptions = {
  revision: string
  prune: boolean
  dryRun: boolean
  force: boolean
  replace: boolean
  /** Apply manifests without running resource hooks. */
  skipHooks: boolean
  retry: boolean
  /** Empty means the whole application. */
  resources: ResourceRef[]
}

export function defaultSyncOptions(): SyncOptions {
  return {
    revision: '',
    prune: false,
    dryRun: false,
    force: false,
    replace: false,
    skipHooks: false,
    retry: false,
    resources: [],
  }
}

/**
 * Translates the sync sheet into an ArgoCD ApplicationSyncRequest.
 *
 * The shapes here are not interchangeable and getting them wrong is
 * destructive: `force` belongs inside the strategy, `Replace=true` is a
 * syncOptions item, and choosing `apply` over `hook` is what skips hooks.
 */
export function buildSyncRequest(o: SyncOptions): Record<string, unknown> {
  const req: Record<string, unknown> = {
    revision: o.revision.trim() || 'HEAD',
    prune: o.prune,
    dryRun: o.dryRun,
    strategy: o.skipHooks ? { apply: { force: o.force } } : { hook: { force: o.force } },
  }
  if (o.replace) {
    req.syncOptions = { items: ['Replace=true'] }
  }
  if (o.resources.length > 0) {
    req.resources = o.resources.map(({ group, kind, name, namespace }) => ({
      group,
      kind,
      name,
      namespace,
    }))
  }
  if (o.retry) {
    req.retryStrategy = { limit: 2, backoff: { duration: '5s', factor: 2, maxDuration: '3m' } }
  }
  return req
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `cd web && npm test`
Expected: PASS, 7 tests.

- [ ] **Step 7: Write the API client**

Create `web/src/api/client.ts`:

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

let onUnauthenticated: () => void = () => {}

/** Registered by the auth provider so a dead session lands on the login screen. */
export function setUnauthenticatedHandler(fn: () => void) {
  onUnauthenticated = fn
}

/** Path of an ArgoCD API call routed through the instance proxy. */
export function argoPath(instance: string, path: string): string {
  return `/api/i/${encodeURIComponent(instance)}/${path}`
}

async function extractError(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const body = JSON.parse(text) as { error?: string; message?: string; detail?: string }
    return body.error ?? body.message ?? body.detail ?? text
  } catch {
    return text.trim() || res.statusText
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (res.status === 401) {
    onUnauthenticated()
    throw new ApiError(401, 'session expired')
  }
  if (!res.ok) {
    throw new ApiError(res.status, await extractError(res))
  }
  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return undefined as T
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
```

- [ ] **Step 8: Write the shared types**

Create `web/src/api/types.ts`:

```ts
export type Health = 'Healthy' | 'Progressing' | 'Degraded' | 'Suspended' | 'Missing' | 'Unknown' | ''
export type SyncStatus = 'Synced' | 'OutOfSync' | 'Unknown' | ''

export type App = {
  instance: string
  name: string
  namespace: string
  project: string
  destServer: string
  destNamespace: string
  health: Health
  sync: SyncStatus
  revision: string
  operationPhase?: string
}

export type InstanceError = { instance: string; message: string }
export type AppsResponse = { apps: App[]; errors: InstanceError[] }

export type InstanceInfo = {
  name: string
  color: string
  production: boolean
  url: string
  reachable: boolean
  tokenValid: boolean
  error?: string
}

export type ResourceRef = {
  group: string
  kind: string
  name: string
  namespace: string
}

export type ResourceNode = ResourceRef & {
  version: string
  uid?: string
  parentRefs?: ResourceRef[]
  health?: { status: Health; message?: string }
  info?: { name: string; value: string }[]
  resourceVersion?: string
  createdAt?: string
}

export type ResourceTree = { nodes?: ResourceNode[] }

export type RevisionHistory = {
  id: number
  revision: string
  deployedAt: string
  source?: { targetRevision?: string; path?: string; repoURL?: string }
}

export type AppDetail = {
  metadata: { name: string; namespace: string }
  spec: {
    project: string
    source?: { repoURL?: string; path?: string; targetRevision?: string }
    destination: { server?: string; namespace?: string }
  }
  status: {
    health?: { status: Health; message?: string }
    sync?: { status: SyncStatus; revision?: string }
    operationState?: {
      phase: string
      message?: string
      startedAt?: string
      finishedAt?: string
    }
    history?: RevisionHistory[]
    conditions?: { type: string; message: string }[]
    resources?: (ResourceRef & { version?: string; status?: SyncStatus; health?: { status: Health } })[]
  }
}

export type ManagedResource = {
  group: string
  kind: string
  name: string
  namespace: string
  targetState: string
  liveState: string
  diff?: string
}

export type AppEvent = {
  reason: string
  message: string
  type: string
  lastTimestamp: string
  involvedObject?: { kind: string; name: string }
}
```

- [ ] **Step 9: Write the query layer**

Create `web/src/api/queries.ts`:

```ts
import { QueryClient, useQuery } from '@tanstack/react-query'
import { api, argoPath } from './client'
import type { AppDetail, AppsResponse, InstanceInfo, ResourceTree } from './types'

/** Foreground poll interval. refetchIntervalInBackground stays false, so the
 * timer is suspended while the tab is hidden and the battery is left alone. */
const POLL_MS = 8_000

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: POLL_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        staleTime: 0,
        retry: 1,
      },
    },
  })
}

export const useApps = () =>
  useQuery({ queryKey: ['apps'], queryFn: () => api.get<AppsResponse>('/api/apps') })

export const useInstances = () =>
  useQuery({
    queryKey: ['instances'],
    queryFn: () => api.get<InstanceInfo[]>('/api/instances'),
    refetchInterval: 60_000,
  })

export const useAppDetail = (instance: string, name: string) =>
  useQuery({
    queryKey: ['app', instance, name],
    queryFn: () => api.get<AppDetail>(argoPath(instance, `applications/${name}`)),
  })

export const useResourceTree = (instance: string, name: string) =>
  useQuery({
    queryKey: ['tree', instance, name],
    queryFn: () => api.get<ResourceTree>(argoPath(instance, `applications/${name}/resource-tree`)),
  })
```

- [ ] **Step 10: Write the status palette**

Create `web/src/lib/status.ts`:

```ts
import type { Health, SyncStatus } from '../api/types'

/** ArgoCD's own status colours: operators already read these at a glance. */
const HEALTH: Record<string, string> = {
  Healthy: '#18be94',
  Progressing: '#0daeeb',
  Degraded: '#e96d76',
  Suspended: '#766f94',
  Missing: '#ccd6dd',
  Unknown: '#ccd6dd',
}

const SYNC: Record<string, string> = {
  Synced: '#18be94',
  OutOfSync: '#f4c030',
  Unknown: '#ccd6dd',
}

export const healthColor = (h: Health) => HEALTH[h] ?? HEALTH.Unknown
export const syncColor = (s: SyncStatus) => SYNC[s] ?? SYNC.Unknown

/** Sort key for triage: what is broken comes first. */
export const healthRank = (h: Health) =>
  ({ Degraded: 0, Missing: 1, Progressing: 2, Unknown: 3, Suspended: 4, Healthy: 5 })[h] ?? 3
```

- [ ] **Step 11: Write the stylesheet and entry point**

Create `web/src/index.css`:

```css
@import 'tailwindcss';

@theme {
  --color-bg: #0b0e14;
  --color-surface: #131823;
  --color-surface-2: #1b2130;
  --color-border: #263041;
  --color-text: #e6ebf4;
  --color-muted: #8b93a7;
  --color-accent: #6ea8fe;
}

html {
  color-scheme: dark;
  background: var(--color-bg);
  /* Keep the layout stable under the iOS keyboard and address bar. */
  height: 100%;
}

body {
  margin: 0;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  overscroll-behavior-y: contain;
  -webkit-tap-highlight-color: transparent;
}

/* Safe areas for the standalone PWA on notched phones. */
.pt-safe { padding-top: max(0.75rem, env(safe-area-inset-top)); }
.pb-safe { padding-bottom: max(0.75rem, env(safe-area-inset-bottom)); }
```

Create `web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { makeQueryClient } from './api/queries'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0e14" />
    <title>MazeCD</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`App.tsx` is created in Task 11; the build will fail until then, which is expected.

- [ ] **Step 12: Commit**

```bash
git add web
git commit -m "feat(web): scaffold, API client, query layer and tested sync mapping"
```

---

### Task 11: Login screen and authenticated shell

**Files:**
- Create: `web/src/App.tsx`, `web/src/screens/Login.tsx`, `web/src/components/Shell.tsx`, `web/src/lib/auth.tsx`
- Test: manual (the auth flow is HTTP plumbing already covered by the Go tests)

**Interfaces:**
- Consumes: `api`, `setUnauthenticatedHandler` (Task 10), `/api/auth/*` (Task 4).
- Produces: `useAuth(): { authenticated: boolean | undefined; login(password): Promise<void>; logout(): Promise<void> }`, `<Shell>` (header + bottom navigation), routes `/` (apps), `/apps/:instance/:name`, `/settings`.

- [ ] **Step 1: Write the auth provider**

Create `web/src/lib/auth.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, setUnauthenticatedHandler } from '../api/client'

type AuthState = {
  /** undefined while the initial check is in flight. */
  authenticated: boolean | undefined
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    setUnauthenticatedHandler(() => setAuthenticated(false))
    api
      .get('/api/auth/me')
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false))
  }, [])

  const login = useCallback(async (password: string) => {
    await api.post('/api/auth/login', { password })
    setAuthenticated(true)
  }, [])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setAuthenticated(false)
  }, [])

  return <Ctx.Provider value={{ authenticated, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
```

- [ ] **Step 2: Write the login screen**

Create `web/src/screens/Login.tsx`:

```tsx
import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { ApiError } from '../api/client'

export function Login() {
  const { login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await login(password)
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Try again in a few minutes.'
          : 'Wrong password.',
      )
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">MazeCD</h1>
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4">
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-14 rounded-xl border border-border bg-surface px-4 text-lg outline-none focus:border-accent"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy || password === ''}
          className="h-14 rounded-xl bg-accent text-lg font-medium text-bg disabled:opacity-40"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="text-center text-sm text-[#e96d76]">{error}</p>}
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Write the shell**

Create `web/src/components/Shell.tsx`:

```tsx
import { Link, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const tab = (to: string, label: string) => (
    <Link
      to={to}
      className={`flex-1 py-3 text-center text-sm ${
        pathname === to ? 'text-accent' : 'text-muted'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex-1 pb-20">{children}</main>
      <nav className="pb-safe fixed inset-x-0 bottom-0 flex border-t border-border bg-surface/95 backdrop-blur">
        {tab('/', 'Apps')}
        {tab('/settings', 'Settings')}
      </nav>
    </div>
  )
}
```

- [ ] **Step 4: Write the router**

Create `web/src/App.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { Login } from './screens/Login'
import { Shell } from './components/Shell'
import { Apps } from './screens/Apps'
import { AppDetailScreen } from './screens/AppDetail'
import { Settings } from './screens/Settings'

function Routed() {
  const { authenticated } = useAuth()
  if (authenticated === undefined) {
    return <div className="flex min-h-dvh items-center justify-center text-muted">…</div>
  }
  if (!authenticated) return <Login />
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Apps />} />
        <Route path="/apps/:instance/:name" element={<AppDetailScreen />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

export function App() {
  return (
    <AuthProvider>
      <Routed />
    </AuthProvider>
  )
}
```

`Apps`, `AppDetailScreen` and `Settings` arrive in Tasks 12, 13 and 17. To keep the build green until then, create the three files now as one-line stubs and replace them in their own tasks:

```tsx
// web/src/screens/Apps.tsx
export function Apps() { return <div className="p-4">apps</div> }
```

```tsx
// web/src/screens/AppDetail.tsx
export function AppDetailScreen() { return <div className="p-4">detail</div> }
```

```tsx
// web/src/screens/Settings.tsx
export function Settings() { return <div className="p-4">settings</div> }
```

- [ ] **Step 5: Verify the login flow end to end**

In one terminal:

```bash
cat > /tmp/mazecd-dev.yaml <<'YAML'
instances:
  - name: dev
    url: https://argocd.example.invalid
    token: ${DEV_TOKEN}
YAML
DEV_TOKEN=dummy \
MAZECD_CONFIG=/tmp/mazecd-dev.yaml \
MAZECD_PASSWORD_HASH="$(printf 'hunter2\n' | go run ./cmd/mazecd hash)" \
MAZECD_SESSION_KEY="$(openssl rand -base64 32)" \
go run ./cmd/mazecd serve
```

In another: `cd web && npm run dev`, then open the printed URL.
Expected: the login screen appears; `hunter2` gets you to the shell; a wrong password shows "Wrong password."; reloading the page keeps you signed in.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): password login, session gate and app shell"
```

---

### Task 12: Aggregated apps list

**Files:**
- Create: `web/src/components/StatusDot.tsx`, `web/src/components/AppRow.tsx`, `web/src/lib/pullToRefresh.ts`
- Modify: `web/src/screens/Apps.tsx` (replace the stub)
- Test: manual

**Interfaces:**
- Consumes: `useApps`, `useInstances` (Task 10), `healthColor`, `syncColor`, `healthRank` (Task 10).
- Produces: `<StatusDot health sync />`, `<AppRow app instanceColor />`, `usePullToRefresh(onRefresh)`.

Deliberate simplification: no list virtualisation. A few hundred rows render fine on a phone and `@tanstack/react-virtual` can be dropped in later behind the same component.

- [ ] **Step 1: Write the pull-to-refresh hook**

Create `web/src/lib/pullToRefresh.ts`:

```ts
import { useEffect, useRef, useState } from 'react'

/**
 * Minimal pull-to-refresh: only arms at the very top of the page and only on
 * a downward drag past the threshold.
 * ponytail: 40 lines of touch handling instead of a gesture library; revisit
 * only if horizontal gestures are ever added.
 */
export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const start = useRef<number | null>(null)

  useEffect(() => {
    const threshold = 70

    const onStart = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const delta = e.touches[0].clientY - start.current
      setPull(delta > 0 ? Math.min(delta, threshold * 1.5) : 0)
    }
    const onEnd = async () => {
      const armed = pull >= threshold
      start.current = null
      setPull(0)
      if (!armed || refreshing) return
      setRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd)
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
  }, [pull, refreshing, onRefresh])

  return { pull, refreshing }
}
```

- [ ] **Step 2: Write the status indicator**

Create `web/src/components/StatusDot.tsx`:

```tsx
import type { Health, SyncStatus } from '../api/types'
import { healthColor, syncColor } from '../lib/status'

export function StatusDot({ health, sync }: { health: Health; sync: SyncStatus }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`size-2.5 rounded-full ${health === 'Progressing' ? 'animate-pulse' : ''}`}
        style={{ background: healthColor(health) }}
        title={`Health: ${health || 'Unknown'}`}
      />
      <span
        className="size-2.5 rounded-full"
        style={{ background: syncColor(sync) }}
        title={`Sync: ${sync || 'Unknown'}`}
      />
    </span>
  )
}
```

- [ ] **Step 3: Write the row**

Create `web/src/components/AppRow.tsx`:

```tsx
import { Link } from 'react-router-dom'
import type { App } from '../api/types'
import { StatusDot } from './StatusDot'

export function AppRow({ app, color }: { app: App; color: string }) {
  const busy = app.operationPhase === 'Running' || app.operationPhase === 'Terminating'
  return (
    <Link
      to={`/apps/${encodeURIComponent(app.instance)}/${encodeURIComponent(app.name)}`}
      className="flex items-center gap-3 border-b border-border px-4 py-3 active:bg-surface-2"
    >
      <span className="h-9 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{app.name}</span>
          {busy && <span className="text-xs text-accent">{app.operationPhase}</span>}
        </span>
        <span className="mt-0.5 flex gap-2 text-xs text-muted">
          <span>{app.instance}</span>
          <span>·</span>
          <span className="truncate">{app.destNamespace || app.project}</span>
        </span>
      </span>
      <StatusDot health={app.health} sync={app.sync} />
    </Link>
  )
}
```

- [ ] **Step 4: Write the list screen**

Replace `web/src/screens/Apps.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useApps, useInstances } from '../api/queries'
import { AppRow } from '../components/AppRow'
import { healthRank } from '../lib/status'
import { usePullToRefresh } from '../lib/pullToRefresh'

type Filter = { instance: string; broken: boolean; outOfSync: boolean; q: string }

export function Apps() {
  const apps = useApps()
  const instances = useInstances()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>({ instance: '', broken: false, outOfSync: false, q: '' })

  const { pull, refreshing } = usePullToRefresh(() =>
    qc.invalidateQueries({ queryKey: ['apps'] }),
  )

  const colors = useMemo(
    () => Object.fromEntries((instances.data ?? []).map((i) => [i.name, i.color])),
    [instances.data],
  )

  const visible = useMemo(() => {
    const list = (apps.data?.apps ?? []).filter((a) => {
      if (filter.instance && a.instance !== filter.instance) return false
      if (filter.broken && a.health !== 'Degraded' && a.health !== 'Missing') return false
      if (filter.outOfSync && a.sync !== 'OutOfSync') return false
      if (filter.q && !a.name.toLowerCase().includes(filter.q.toLowerCase())) return false
      return true
    })
    // Triage order: broken first, then out of sync, then alphabetical.
    return list.sort(
      (a, b) =>
        healthRank(a.health) - healthRank(b.health) ||
        Number(b.sync === 'OutOfSync') - Number(a.sync === 'OutOfSync') ||
        a.name.localeCompare(b.name),
    )
  }, [apps.data, filter])

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-sm ${
      active ? 'border-accent text-accent' : 'border-border text-muted'
    }`

  return (
    <div>
      <header className="pt-safe sticky top-0 z-10 border-b border-border bg-bg/95 px-4 pb-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Applications</h1>
          <span className="text-xs text-muted">
            {visible.length}
            {refreshing || apps.isFetching ? ' · refreshing' : ''}
          </span>
        </div>
        <input
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          placeholder="Search"
          className="mt-3 h-10 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent"
        />
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button className={chip(filter.broken)} onClick={() => setFilter({ ...filter, broken: !filter.broken })}>
            Broken
          </button>
          <button
            className={chip(filter.outOfSync)}
            onClick={() => setFilter({ ...filter, outOfSync: !filter.outOfSync })}
          >
            OutOfSync
          </button>
          {(instances.data ?? []).map((i) => (
            <button
              key={i.name}
              className={chip(filter.instance === i.name)}
              onClick={() =>
                setFilter({ ...filter, instance: filter.instance === i.name ? '' : i.name })
              }
            >
              <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: i.color }} />
              {i.name}
            </button>
          ))}
        </div>
      </header>

      {pull > 0 && <div className="py-2 text-center text-xs text-muted">Pull to refresh</div>}

      {(apps.data?.errors ?? []).map((e) => (
        <div key={e.instance} className="border-b border-border bg-[#3a1d22] px-4 py-2 text-sm">
          <strong>{e.instance}</strong> is unreachable — {e.message}
        </div>
      ))}

      {apps.isError && (
        <p className="p-4 text-sm text-[#e96d76]">Could not load applications: {String(apps.error)}</p>
      )}

      {visible.map((a) => (
        <AppRow key={`${a.instance}/${a.name}`} app={a} color={colors[a.instance] ?? '#8b93a7'} />
      ))}

      {!apps.isLoading && visible.length === 0 && (
        <p className="p-8 text-center text-sm text-muted">No applications match the filters.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Verify against a real instance**

Point `/tmp/mazecd-dev.yaml` at a reachable ArgoCD instance with a real token, restart the backend, reload the dev server.
Expected: every application from every configured instance appears with its instance badge; broken ones sort to the top; toggling a chip filters; killing network shows the unreachable banner rather than an empty list.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): aggregated application list with triage sorting and filters"
```

---

### Task 13: Application detail, resource tree and tabs

**Files:**
- Create: `web/src/components/Tree.tsx`, `web/src/components/Tabs.tsx`, `web/src/screens/tabs/DiffTab.tsx`, `web/src/screens/tabs/EventsTab.tsx`, `web/src/screens/tabs/ManifestTab.tsx`
- Modify: `web/src/screens/AppDetail.tsx` (replace the stub)
- Test: manual

**Interfaces:**
- Consumes: `useAppDetail`, `useResourceTree` (Task 10), types from Task 10.
- Produces: `<Tree nodes onSelect />`, `<Tabs tabs active onChange />`, the three tab components, and `AppDetailScreen` reading `:instance` and `:name` from the route. `AppDetailScreen` owns the `selected` resource state consumed by Task 15 and the action bar filled in by Tasks 14 and 16.

- [ ] **Step 1: Write the tabs primitive**

Create `web/src/components/Tabs.tsx`:

```tsx
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly T[]
  active: T
  onChange: (t: T) => void
}) {
  return (
    <div className="flex border-b border-border">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`flex-1 py-3 text-sm ${
            t === active ? 'border-b-2 border-accent text-text' : 'text-muted'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write the resource tree**

Create `web/src/components/Tree.tsx`:

```tsx
import { useMemo } from 'react'
import type { ResourceNode } from '../api/types'
import { healthColor } from '../lib/status'

type TreeNode = ResourceNode & { children: TreeNode[] }

/** ArgoCD returns a flat node list with parentRefs; rebuild the hierarchy. */
function build(nodes: ResourceNode[]): TreeNode[] {
  const key = (n: { group?: string; kind: string; name: string; namespace: string }) =>
    `${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`
  const byKey = new Map<string, TreeNode>()
  for (const n of nodes) byKey.set(key(n), { ...n, children: [] })
  const roots: TreeNode[] = []
  for (const n of byKey.values()) {
    const parent = n.parentRefs?.length ? byKey.get(key(n.parentRefs[0])) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  const sort = (list: TreeNode[]) => {
    list.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
    list.forEach((n) => sort(n.children))
  }
  sort(roots)
  return roots
}

export function Tree({
  nodes,
  onSelect,
}: {
  nodes: ResourceNode[]
  onSelect: (n: ResourceNode) => void
}) {
  const roots = useMemo(() => build(nodes), [nodes])

  const render = (n: TreeNode, depth: number) => (
    <div key={`${n.group ?? ''}/${n.kind}/${n.namespace}/${n.name}`}>
      <button
        onClick={() => onSelect(n)}
        className="flex w-full items-center gap-2 border-b border-border px-4 py-2.5 text-left active:bg-surface-2"
        style={{ paddingLeft: `${1 + depth * 0.9}rem` }}
      >
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: healthColor(n.health?.status ?? '') }}
        />
        <span className="w-28 shrink-0 truncate text-xs text-muted">{n.kind}</span>
        <span className="min-w-0 flex-1 truncate text-sm">{n.name}</span>
      </button>
      {n.children.map((c) => render(c, depth + 1))}
    </div>
  )

  if (nodes.length === 0) {
    return <p className="p-8 text-center text-sm text-muted">No managed resources.</p>
  }
  return <div>{roots.map((n) => render(n, 0))}</div>
}
```

- [ ] **Step 3: Write the diff tab**

Create `web/src/screens/tabs/DiffTab.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { createTwoFilesPatch } from 'diff'
import { api, argoPath } from '../../api/client'
import type { ManagedResource } from '../../api/types'

const pretty = (raw: string) => {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function DiffTab({ instance, name }: { instance: string; name: string }) {
  const q = useQuery({
    queryKey: ['managed', instance, name],
    queryFn: () =>
      api.get<{ items?: ManagedResource[] }>(
        argoPath(instance, `applications/${name}/managed-resources`),
      ),
  })

  const changed = (q.data?.items ?? []).filter((r) => pretty(r.liveState) !== pretty(r.targetState))

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading diff…</p>
  if (q.isError) return <p className="p-4 text-sm text-[#e96d76]">{String(q.error)}</p>
  if (changed.length === 0) return <p className="p-8 text-center text-sm text-muted">No differences.</p>

  return (
    <div className="divide-y divide-border">
      {changed.map((r) => {
        const patch = createTwoFilesPatch(
          'live',
          'desired',
          pretty(r.liveState),
          pretty(r.targetState),
          '',
          '',
          { context: 3 },
        )
        return (
          <section key={`${r.group}/${r.kind}/${r.namespace}/${r.name}`} className="py-3">
            <h3 className="px-4 text-sm font-medium">
              {r.kind} <span className="text-muted">{r.name}</span>
            </h3>
            <pre className="mt-2 overflow-x-auto px-4 text-[11px] leading-relaxed">
              {patch
                .split('\n')
                .slice(4)
                .map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.startsWith('+')
                        ? 'text-[#18be94]'
                        : line.startsWith('-')
                          ? 'text-[#e96d76]'
                          : 'text-muted'
                    }
                  >
                    {line || ' '}
                  </div>
                ))}
            </pre>
          </section>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Write the events tab**

Create `web/src/screens/tabs/EventsTab.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { api, argoPath } from '../../api/client'
import type { AppEvent } from '../../api/types'

export function EventsTab({ instance, name }: { instance: string; name: string }) {
  const q = useQuery({
    queryKey: ['events', instance, name],
    queryFn: () =>
      api.get<{ items?: AppEvent[] }>(argoPath(instance, `applications/${name}/events`)),
  })

  const items = [...(q.data?.items ?? [])].sort((a, b) =>
    (b.lastTimestamp ?? '').localeCompare(a.lastTimestamp ?? ''),
  )

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading events…</p>
  if (items.length === 0) return <p className="p-8 text-center text-sm text-muted">No events.</p>

  return (
    <ul className="divide-y divide-border">
      {items.map((e, i) => (
        <li key={i} className="px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={e.type === 'Warning' ? 'text-[#f4c030]' : 'text-muted'}>{e.reason}</span>
            <span className="text-xs text-muted">
              {e.involvedObject?.kind} {e.involvedObject?.name}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">{e.message}</p>
          <p className="mt-1 text-[11px] text-muted">{e.lastTimestamp}</p>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 5: Write the manifest tab**

Create `web/src/screens/tabs/ManifestTab.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { api, argoPath } from '../../api/client'

export function ManifestTab({ instance, name }: { instance: string; name: string }) {
  const q = useQuery({
    queryKey: ['manifests', instance, name],
    queryFn: () =>
      api.get<{ manifests?: string[] }>(argoPath(instance, `applications/${name}/manifests`)),
    // Manifests only change on a new revision: no need to poll them.
    refetchInterval: false,
  })

  if (q.isLoading) return <p className="p-4 text-sm text-muted">Loading manifests…</p>
  if (q.isError) return <p className="p-4 text-sm text-[#e96d76]">{String(q.error)}</p>

  return (
    <div className="divide-y divide-border">
      {(q.data?.manifests ?? []).map((m, i) => (
        <pre key={i} className="overflow-x-auto p-4 text-[11px] leading-relaxed text-muted">
          {m}
        </pre>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Write the detail screen**

Replace `web/src/screens/AppDetail.tsx`:

```tsx
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAppDetail, useResourceTree } from '../api/queries'
import { Tabs } from '../components/Tabs'
import { Tree } from '../components/Tree'
import { StatusDot } from '../components/StatusDot'
import { DiffTab } from './tabs/DiffTab'
import { EventsTab } from './tabs/EventsTab'
import { ManifestTab } from './tabs/ManifestTab'
import type { ResourceNode } from '../api/types'

const TABS = ['Tree', 'Diff', 'Events', 'Manifest'] as const

export function AppDetailScreen() {
  const { instance = '', name = '' } = useParams()
  const detail = useAppDetail(instance, name)
  const tree = useResourceTree(instance, name)
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tree')
  const [selected, setSelected] = useState<ResourceNode | null>(null)

  const status = detail.data?.status
  const op = status?.operationState

  return (
    <div>
      <header className="pt-safe sticky top-0 z-10 border-b border-border bg-bg/95 px-4 pb-3 backdrop-blur">
        <Link to="/" className="text-sm text-accent">
          ← Applications
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold">{name}</h1>
          <StatusDot health={status?.health?.status ?? ''} sync={status?.sync?.status ?? ''} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {instance} · {detail.data?.spec.project} · {detail.data?.spec.destination.namespace} ·{' '}
          {status?.sync?.revision?.slice(0, 7)}
        </p>
        {op && (
          <p className="mt-2 text-xs">
            <span className="text-accent">{op.phase}</span>
            {op.message ? ` — ${op.message}` : ''}
          </p>
        )}
        {status?.health?.message && (
          <p className="mt-2 text-xs text-[#f4c030]">{status.health.message}</p>
        )}
        {/* The action bar is added in Task 14 (sync, refresh) and Task 16
            (history, delete). */}
      </header>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === 'Tree' && (
        <Tree nodes={tree.data?.nodes ?? []} onSelect={setSelected} />
      )}
      {tab === 'Diff' && <DiffTab instance={instance} name={name} />}
      {tab === 'Events' && <EventsTab instance={instance} name={name} />}
      {tab === 'Manifest' && <ManifestTab instance={instance} name={name} />}

      {/* The resource sheet for `selected` is added in Task 15. */}
      {selected && (
        <div className="p-4 text-xs text-muted">
          selected: {selected.kind}/{selected.name}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Verify against a real instance**

Open an application from the list.
Expected: header shows health, sync, revision and any operation in progress; the Tree tab shows the hierarchy with per-node health; Diff shows unified diffs only for resources that actually differ; Events lists newest first; Manifest renders the desired manifests.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "feat(web): application detail with resource tree, diff, events and manifests"
```

---

### Task 14: Sync, refresh and terminate

**Files:**
- Create: `web/src/components/Sheet.tsx`, `web/src/components/ConfirmSheet.tsx`, `web/src/components/SyncSheet.tsx`, `web/src/api/actions.ts`
- Modify: `web/src/screens/AppDetail.tsx` (action bar)
- Test: the mapping test from Task 10 already covers the payload; verify manually against a real instance

**Interfaces:**
- Consumes: `buildSyncRequest`, `defaultSyncOptions` (Task 10), `api`, `argoPath`.
- Produces: `<Sheet open onClose title>`, `<ConfirmSheet open title body confirmLabel requireTyping onConfirm onClose>`, `<SyncSheet open instance name production operationRunning selection onClose>`, and in `actions.ts`: `syncApp`, `refreshApp`, `terminateOperation`, `rollbackApp`, `deleteApp`, `deleteResource`, `runResourceAction`.

- [ ] **Step 1: Write the action functions**

Create `web/src/api/actions.ts`:

```ts
import { api, argoPath } from './client'
import { buildSyncRequest, type SyncOptions } from '../lib/sync'
import type { ResourceNode } from './types'

export const syncApp = (instance: string, name: string, options: SyncOptions) =>
  api.post(argoPath(instance, `applications/${name}/sync`), buildSyncRequest(options))

/** refresh=normal re-reads git; refresh=hard also discards cached manifests. */
export const refreshApp = (instance: string, name: string, hard: boolean) =>
  api.get(argoPath(instance, `applications/${name}?refresh=${hard ? 'hard' : 'normal'}`))

export const terminateOperation = (instance: string, name: string) =>
  api.del(argoPath(instance, `applications/${name}/operation`))

export const rollbackApp = (instance: string, name: string, id: number) =>
  api.post(argoPath(instance, `applications/${name}/rollback`), { id, name })

export const deleteApp = (instance: string, name: string, cascade: boolean) =>
  api.del(argoPath(instance, `applications/${name}?cascade=${cascade}`))

const resourceQuery = (n: ResourceNode) =>
  new URLSearchParams({
    namespace: n.namespace,
    resourceName: n.name,
    version: n.version,
    kind: n.kind,
    group: n.group ?? '',
  }).toString()

export const deleteResource = (instance: string, name: string, n: ResourceNode, force: boolean) =>
  api.del(
    argoPath(instance, `applications/${name}/resource?${resourceQuery(n)}&force=${force}&orphan=false`),
  )

/** ArgoCD resource actions, e.g. "restart" on a Deployment. */
export const runResourceAction = (
  instance: string,
  name: string,
  n: ResourceNode,
  action: string,
) =>
  api.post(argoPath(instance, `applications/${name}/resource/actions?${resourceQuery(n)}`), action)
```

- [ ] **Step 2: Write the sheet primitives**

Create `web/src/components/Sheet.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="pb-safe relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-surface">
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
          <h2 className="font-medium">{title}</h2>
          <button onClick={onClose} className="px-2 text-muted">
            Close
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
```

Create `web/src/components/ConfirmSheet.tsx`:

```tsx
import { useState } from 'react'
import { Sheet } from './Sheet'

/**
 * Every destructive confirmation names the instance and the application in
 * full: acting on the wrong instance is the main hazard of a multi-instance
 * client. `requireTyping` forces the app name to be typed out.
 */
export function ConfirmSheet({
  open,
  title,
  instance,
  instanceColor,
  app,
  body,
  confirmLabel,
  requireTyping = false,
  destructive = true,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  instance: string
  instanceColor: string
  app: string
  body?: string
  confirmLabel: string
  requireTyping?: boolean
  destructive?: boolean
  onConfirm: () => Promise<unknown>
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ready = !requireTyping || typed === app

  async function go() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      setTyped('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <span className="h-10 w-1.5 rounded-full" style={{ background: instanceColor }} />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">{instance}</p>
          <p className="truncate font-medium">{app}</p>
        </div>
      </div>
      {body && <p className="mt-3 text-sm text-muted">{body}</p>}
      {requireTyping && (
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={`Type ${app} to confirm`}
          className="mt-3 h-12 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent"
        />
      )}
      {error && <p className="mt-3 text-sm text-[#e96d76]">{error}</p>}
      <button
        onClick={go}
        disabled={!ready || busy}
        className={`mt-4 h-14 w-full rounded-xl text-lg font-medium disabled:opacity-40 ${
          destructive ? 'bg-[#e96d76] text-bg' : 'bg-accent text-bg'
        }`}
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </Sheet>
  )
}
```

- [ ] **Step 3: Write the sync sheet**

Create `web/src/components/SyncSheet.tsx`:

```tsx
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { defaultSyncOptions, type SyncOptions } from '../lib/sync'
import { syncApp } from '../api/actions'
import type { ResourceNode } from '../api/types'

const TOGGLES: { key: keyof SyncOptions; label: string; hint: string }[] = [
  { key: 'prune', label: 'Prune', hint: 'Delete resources no longer in git' },
  { key: 'dryRun', label: 'Dry run', hint: 'Report what would change, apply nothing' },
  { key: 'force', label: 'Force', hint: 'Replace conflicting resources' },
  { key: 'replace', label: 'Replace', hint: 'Use replace instead of apply' },
  { key: 'skipHooks', label: 'Skip hooks', hint: 'Apply manifests without running hooks' },
  { key: 'retry', label: 'Retry', hint: 'Retry twice with backoff on failure' },
]

export function SyncSheet({
  open,
  onClose,
  instance,
  instanceColor,
  name,
  production,
  selection,
}: {
  open: boolean
  onClose: () => void
  instance: string
  instanceColor: string
  name: string
  production: boolean
  selection: ResourceNode[]
}) {
  const [opts, setOpts] = useState<SyncOptions>(defaultSyncOptions())
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const qc = useQueryClient()

  const needsConfirm = production && !opts.dryRun

  async function run() {
    setBusy(true)
    setError('')
    try {
      await syncApp(instance, name, { ...opts, resources: selection })
      await qc.invalidateQueries({ queryKey: ['app', instance, name] })
      await qc.invalidateQueries({ queryKey: ['apps'] })
      onClose()
      setConfirming(false)
      setOpts(defaultSyncOptions())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Sync">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <span className="h-10 w-1.5 rounded-full" style={{ background: instanceColor }} />
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted">
            {instance}
            {production ? ' · production' : ''}
          </p>
          <p className="truncate font-medium">{name}</p>
        </div>
      </div>

      <label className="mt-4 block text-sm text-muted">Revision</label>
      <input
        value={opts.revision}
        onChange={(e) => setOpts({ ...opts, revision: e.target.value })}
        placeholder="HEAD"
        className="mt-1 h-12 w-full rounded-lg border border-border bg-surface px-3 outline-none focus:border-accent"
      />

      {selection.length > 0 && (
        <p className="mt-3 rounded-lg border border-accent/40 p-3 text-sm">
          Syncing {selection.length} selected resource{selection.length > 1 ? 's' : ''} only.
        </p>
      )}

      <div className="mt-4 divide-y divide-border">
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center gap-3 py-3">
            <input
              type="checkbox"
              checked={Boolean(opts[t.key])}
              onChange={(e) => setOpts({ ...opts, [t.key]: e.target.checked })}
              className="size-5 accent-[#6ea8fe]"
            />
            <span className="flex-1">
              <span className="block text-sm">{t.label}</span>
              <span className="block text-xs text-muted">{t.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-[#e96d76]">{error}</p>}

      {!confirming ? (
        <button
          onClick={() => (needsConfirm ? setConfirming(true) : run())}
          disabled={busy}
          className="mt-4 h-14 w-full rounded-xl bg-accent text-lg font-medium text-bg disabled:opacity-40"
        >
          {opts.dryRun ? 'Dry run' : 'Synchronize'}
        </button>
      ) : (
        <div className="mt-4 rounded-xl border border-[#f4c030] p-3">
          <p className="text-sm">
            This is a production instance. Synchronize <strong>{name}</strong> on{' '}
            <strong>{instance}</strong>?
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setConfirming(false)} className="h-12 flex-1 rounded-lg border border-border">
              Cancel
            </button>
            <button
              onClick={run}
              disabled={busy}
              className="h-12 flex-1 rounded-lg bg-[#f4c030] font-medium text-bg disabled:opacity-40"
            >
              {busy ? 'Syncing…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
```

- [ ] **Step 4: Add the action bar to the detail screen**

In `web/src/screens/AppDetail.tsx`, add the imports and state:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useInstances } from '../api/queries'
import { SyncSheet } from '../components/SyncSheet'
import { refreshApp, terminateOperation } from '../api/actions'
```

Inside `AppDetailScreen`, before the return:

```tsx
  const qc = useQueryClient()
  const instances = useInstances()
  const meta = (instances.data ?? []).find((i) => i.name === instance)
  const [syncOpen, setSyncOpen] = useState(false)
  const [selection, setSelection] = useState<ResourceNode[]>([])
  const [actionError, setActionError] = useState('')
  const running = op?.phase === 'Running'

  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['app', instance, name] }),
      qc.invalidateQueries({ queryKey: ['tree', instance, name] }),
      qc.invalidateQueries({ queryKey: ['apps'] }),
    ])

  async function act(fn: () => Promise<unknown>) {
    setActionError('')
    try {
      await fn()
      await invalidate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }
```

Replace the action-bar comment with:

```tsx
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setSyncOpen(true)}
            disabled={running}
            className="h-11 flex-1 rounded-lg bg-accent font-medium text-bg disabled:opacity-40"
          >
            Sync
          </button>
          <button
            onClick={() => act(() => refreshApp(instance, name, false))}
            onContextMenu={(e) => {
              e.preventDefault()
              void act(() => refreshApp(instance, name, true))
            }}
            className="h-11 flex-1 rounded-lg border border-border"
            title="Long press or right click for a hard refresh"
          >
            Refresh
          </button>
          {running && (
            <button
              onClick={() => act(() => terminateOperation(instance, name))}
              className="h-11 flex-1 rounded-lg border border-[#e96d76] text-[#e96d76]"
            >
              Terminate
            </button>
          )}
        </div>
        {actionError && <p className="mt-2 text-xs text-[#e96d76]">{actionError}</p>}
```

And before the closing `</div>` of the screen:

```tsx
      <SyncSheet
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        instance={instance}
        instanceColor={meta?.color ?? '#8b93a7'}
        name={name}
        production={meta?.production ?? false}
        selection={selection}
      />
```

Wire selection from the tree by replacing the `Tree` usage:

```tsx
      {tab === 'Tree' && (
        <>
          {selection.length > 0 && (
            <div className="flex items-center justify-between border-b border-border px-4 py-2 text-sm">
              <span>{selection.length} selected for sync</span>
              <button className="text-accent" onClick={() => setSelection([])}>
                Clear
              </button>
            </div>
          )}
          <Tree
            nodes={tree.data?.nodes ?? []}
            onSelect={setSelected}
            selection={selection}
            onToggleSelect={(n) =>
              setSelection((cur) =>
                cur.some((c) => c.kind === n.kind && c.name === n.name && c.namespace === n.namespace)
                  ? cur.filter((c) => !(c.kind === n.kind && c.name === n.name && c.namespace === n.namespace))
                  : [...cur, n],
              )
            }
          />
        </>
      )}
```

Extend `Tree` in `web/src/components/Tree.tsx` with the two new optional props:

```tsx
export function Tree({
  nodes,
  onSelect,
  selection = [],
  onToggleSelect,
}: {
  nodes: ResourceNode[]
  onSelect: (n: ResourceNode) => void
  selection?: ResourceNode[]
  onToggleSelect?: (n: ResourceNode) => void
}) {
```

and inside `render`, before the kind label:

```tsx
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selection.some(
              (s) => s.kind === n.kind && s.name === n.name && s.namespace === n.namespace,
            )}
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggleSelect(n)}
            className="size-4 shrink-0 accent-[#6ea8fe]"
          />
        )}
```

- [ ] **Step 5: Verify the sync payload against a real instance**

Use a non-production test application.
Expected: a plain Sync starts an operation and the header shows `Running`; Dry run reports without changing anything; Terminate appears only while an operation runs and stops it; selecting two resources and syncing shows only those in the ArgoCD operation details; on a `production: true` instance the confirm step appears first.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): sync sheet with full options, refresh, hard refresh and terminate"
```

---

### Task 15: Resource sheet with log streaming and resource actions

**Files:**
- Create: `web/src/components/ResourceSheet.tsx`, `web/src/lib/logs.ts`
- Modify: `web/src/screens/AppDetail.tsx` (mount the sheet on `selected`)
- Test: manual

**Interfaces:**
- Consumes: `argoPath`, `api`, `deleteResource`, `runResourceAction` (Task 14), `ResourceNode`.
- Produces: `streamLogs({instance, app, node, container, onLine, signal})`, `<ResourceSheet node instance instanceColor app onClose />`.

- [ ] **Step 1: Write the log stream reader**

Create `web/src/lib/logs.ts`:

```ts
import { argoPath } from '../api/client'
import type { ResourceNode } from '../api/types'

/**
 * ArgoCD streams pod logs as newline-delimited JSON objects
 * ({"result":{"content":"…"}}), so the response is read incrementally rather
 * than awaited as a whole.
 */
export async function streamLogs(args: {
  instance: string
  app: string
  node: ResourceNode
  container?: string
  tailLines?: number
  onLine: (line: string) => void
  signal: AbortSignal
}) {
  const params = new URLSearchParams({
    podName: args.node.name,
    namespace: args.node.namespace,
    tailLines: String(args.tailLines ?? 200),
    follow: 'true',
  })
  if (args.container) params.set('container', args.container)

  const res = await fetch(argoPath(args.instance, `applications/${args.app}/logs?${params}`), {
    credentials: 'same-origin',
    signal: args.signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`log stream failed: ${res.status} ${await res.text()}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      if (!raw.trim()) continue
      try {
        const parsed = JSON.parse(raw) as { result?: { content?: string } }
        if (parsed.result?.content !== undefined) args.onLine(parsed.result.content)
      } catch {
        args.onLine(raw)
      }
    }
  }
}
```

- [ ] **Step 2: Write the resource sheet**

Create `web/src/components/ResourceSheet.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { ConfirmSheet } from './ConfirmSheet'
import { api, argoPath } from '../api/client'
import { deleteResource, runResourceAction } from '../api/actions'
import { streamLogs } from '../lib/logs'
import type { ResourceNode } from '../api/types'

const TABS = ['Logs', 'Manifest', 'Actions'] as const

export function ResourceSheet({
  node,
  instance,
  instanceColor,
  app,
  onClose,
}: {
  node: ResourceNode
  instance: string
  instanceColor: string
  app: string
  onClose: () => void
}) {
  const isPod = node.kind === 'Pod'
  const [tab, setTab] = useState<(typeof TABS)[number]>(isPod ? 'Logs' : 'Manifest')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const qc = useQueryClient()

  return (
    <Sheet open onClose={onClose} title={`${node.kind} ${node.name}`}>
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-3">
        <span className="h-8 w-1.5 rounded-full" style={{ background: instanceColor }} />
        <p className="min-w-0 truncate text-xs text-muted">
          {instance} · {node.namespace}
          {node.health?.status ? ` · ${node.health.status}` : ''}
        </p>
      </div>
      {node.health?.message && <p className="mt-2 text-xs text-[#f4c030]">{node.health.message}</p>}

      <div className="mt-3 flex gap-2">
        {TABS.filter((t) => t !== 'Logs' || isPod).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              tab === t ? 'border-accent text-accent' : 'border-border text-muted'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {tab === 'Logs' && isPod && <Logs instance={instance} app={app} node={node} />}
        {tab === 'Manifest' && <Manifest instance={instance} app={app} node={node} />}
        {tab === 'Actions' && (
          <Actions
            instance={instance}
            app={app}
            node={node}
            onDone={() => qc.invalidateQueries({ queryKey: ['tree', instance, app] })}
            onDelete={() => setConfirmDelete(true)}
          />
        )}
      </div>

      <ConfirmSheet
        open={confirmDelete}
        title={`Delete ${node.kind}`}
        instance={instance}
        instanceColor={instanceColor}
        app={node.name}
        body="The resource is deleted in the cluster. ArgoCD recreates it on the next sync if it is still declared in git."
        confirmLabel={`Delete ${node.kind}`}
        requireTyping
        onConfirm={async () => {
          await deleteResource(instance, app, node, false)
          await qc.invalidateQueries({ queryKey: ['tree', instance, app] })
          onClose()
        }}
        onClose={() => setConfirmDelete(false)}
      />
    </Sheet>
  )
}

function Logs({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState('')
  const [container, setContainer] = useState('')
  const [filter, setFilter] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctrl = new AbortController()
    setLines([])
    setError('')
    streamLogs({
      instance,
      app,
      node,
      container: container || undefined,
      // Keep memory bounded: a chatty pod can emit thousands of lines a minute.
      onLine: (l) => setLines((cur) => (cur.length > 2000 ? [...cur.slice(-1500), l] : [...cur, l])),
      signal: ctrl.signal,
    }).catch((e) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
    })
    return () => ctrl.abort()
  }, [instance, app, node, container])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [lines])

  const shown = filter ? lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase())) : lines

  return (
    <div>
      <div className="flex gap-2">
        <input
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          placeholder="container (optional)"
          className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent"
        />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter"
          className="h-10 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:border-accent"
        />
      </div>
      {error && <p className="mt-2 text-sm text-[#e96d76]">{error}</p>}
      <pre className="mt-2 max-h-[50dvh] overflow-auto rounded-lg bg-bg p-3 text-[11px] leading-relaxed">
        {shown.join('\n') || (error ? '' : 'waiting for output…')}
        <div ref={bottom} />
      </pre>
    </div>
  )
}

function Manifest({ instance, app, node }: { instance: string; app: string; node: ResourceNode }) {
  const q = useQuery({
    queryKey: ['resource', instance, app, node.kind, node.namespace, node.name],
    queryFn: () =>
      api.get<{ manifest?: string }>(
        argoPath(
          instance,
          `applications/${app}/resource?` +
            new URLSearchParams({
              namespace: node.namespace,
              resourceName: node.name,
              version: node.version,
              kind: node.kind,
              group: node.group ?? '',
            }),
        ),
      ),
    refetchInterval: false,
  })
  if (q.isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (q.isError) return <p className="text-sm text-[#e96d76]">{String(q.error)}</p>
  return (
    <pre className="max-h-[50dvh] overflow-auto rounded-lg bg-bg p-3 text-[11px] leading-relaxed text-muted">
      {q.data?.manifest ?? ''}
    </pre>
  )
}

function Actions({
  instance,
  app,
  node,
  onDone,
  onDelete,
}: {
  instance: string
  app: string
  node: ResourceNode
  onDone: () => void
  onDelete: () => void
}) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  // Asking ArgoCD which actions exist beats hard-coding a kind list: custom
  // resource actions defined in argocd-cm show up for free.
  const q = useQuery({
    queryKey: ['actions', instance, app, node.kind, node.namespace, node.name],
    queryFn: () =>
      api.get<{ actions?: { name: string; disabled?: boolean }[] }>(
        argoPath(
          instance,
          `applications/${app}/resource/actions?` +
            new URLSearchParams({
              namespace: node.namespace,
              resourceName: node.name,
              version: node.version,
              kind: node.kind,
              group: node.group ?? '',
            }),
        ),
      ),
    refetchInterval: false,
  })

  async function run(action: string) {
    setBusy(action)
    setError('')
    try {
      await runResourceAction(instance, app, node, action)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {(q.data?.actions ?? [])
        .filter((a) => !a.disabled)
        .map((a) => (
          <button
            key={a.name}
            onClick={() => run(a.name)}
            disabled={busy !== ''}
            className="h-12 rounded-lg border border-border text-sm capitalize disabled:opacity-40"
          >
            {busy === a.name ? 'Running…' : a.name}
          </button>
        ))}
      <button onClick={onDelete} className="h-12 rounded-lg border border-[#e96d76] text-sm text-[#e96d76]">
        Delete {node.kind}
      </button>
      {error && <p className="text-sm text-[#e96d76]">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Mount it in the detail screen**

In `web/src/screens/AppDetail.tsx`, import it and replace the `selected` placeholder block:

```tsx
import { ResourceSheet } from '../components/ResourceSheet'
```

```tsx
      {selected && (
        <ResourceSheet
          node={selected}
          instance={instance}
          instanceColor={meta?.color ?? '#8b93a7'}
          app={name}
          onClose={() => setSelected(null)}
        />
      )}
```

- [ ] **Step 4: Verify against a real instance**

Expected: tapping a Pod opens the sheet on Logs and lines stream in live; typing in the filter narrows them; closing the sheet stops the request (check the browser network panel: the log request ends); a Deployment shows `restart` under Actions and running it restarts the workload; Delete requires typing the resource name.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): resource sheet with streaming logs, manifest and resource actions"
```

---

### Task 16: History, rollback and application deletion

**Files:**
- Create: `web/src/components/HistorySheet.tsx`
- Modify: `web/src/screens/AppDetail.tsx` (History and Delete buttons)
- Test: manual

**Interfaces:**
- Consumes: `rollbackApp`, `deleteApp` (Task 14), `useAppDetail` (Task 10), `<ConfirmSheet>` (Task 14).
- Produces: `<HistorySheet open instance instanceColor name history onClose />`.

- [ ] **Step 1: Write the history sheet**

Create `web/src/components/HistorySheet.tsx`:

```tsx
import { useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { Sheet } from './Sheet'
import { ConfirmSheet } from './ConfirmSheet'
import { api, argoPath } from '../api/client'
import { rollbackApp } from '../api/actions'
import type { RevisionHistory } from '../api/types'

export function HistorySheet({
  open,
  onClose,
  instance,
  instanceColor,
  name,
  history,
  currentRevision,
}: {
  open: boolean
  onClose: () => void
  instance: string
  instanceColor: string
  name: string
  history: RevisionHistory[]
  currentRevision?: string
}) {
  const qc = useQueryClient()
  const [target, setTarget] = useState<RevisionHistory | null>(null)

  // Newest first, and only the last ten: older entries are rarely a rollback
  // target and each one costs a metadata request.
  const items = [...history].sort((a, b) => b.id - a.id).slice(0, 10)

  const metadata = useQueries({
    queries: items.map((h) => ({
      queryKey: ['revmeta', instance, name, h.revision],
      queryFn: () =>
        api.get<{ author?: string; date?: string; message?: string }>(
          argoPath(instance, `applications/${name}/revisions/${h.revision}/metadata`),
        ),
      refetchInterval: false,
      retry: false,
    })),
  })

  return (
    <Sheet open={open} onClose={onClose} title="History">
      <ul className="divide-y divide-border">
        {items.map((h, i) => {
          const meta = metadata[i]?.data
          const current = h.revision === currentRevision
          return (
            <li key={h.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">
                  {h.revision.slice(0, 7)}
                  {current && <span className="ml-2 text-xs text-[#18be94]">current</span>}
                </p>
                {meta?.message && <p className="mt-0.5 truncate text-sm">{meta.message.split('\n')[0]}</p>}
                <p className="mt-0.5 text-xs text-muted">
                  {new Date(h.deployedAt).toLocaleString()}
                  {meta?.author ? ` · ${meta.author}` : ''}
                </p>
              </div>
              {!current && (
                <button
                  onClick={() => setTarget(h)}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm"
                >
                  Roll back
                </button>
              )}
            </li>
          )
        })}
        {items.length === 0 && <li className="py-8 text-center text-sm text-muted">No deployment history.</li>}
      </ul>

      {target && (
        <ConfirmSheet
          open
          title="Roll back"
          instance={instance}
          instanceColor={instanceColor}
          app={name}
          body={`Deploy revision ${target.revision.slice(0, 7)} again. This starts a sync with automated sync temporarily disabled by ArgoCD.`}
          confirmLabel="Roll back"
          onConfirm={async () => {
            await rollbackApp(instance, name, target.id)
            await qc.invalidateQueries({ queryKey: ['app', instance, name] })
            setTarget(null)
            onClose()
          }}
          onClose={() => setTarget(null)}
        />
      )}
    </Sheet>
  )
}
```

- [ ] **Step 2: Wire History and Delete into the action bar**

In `web/src/screens/AppDetail.tsx` add:

```tsx
import { useNavigate } from 'react-router-dom'
import { HistorySheet } from '../components/HistorySheet'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { deleteApp } from '../api/actions'
```

State:

```tsx
  const navigate = useNavigate()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
```

Add to the action bar, after the Refresh button:

```tsx
          <button onClick={() => setHistoryOpen(true)} className="h-11 flex-1 rounded-lg border border-border">
            History
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="h-11 w-11 rounded-lg border border-[#e96d76] text-[#e96d76]"
            aria-label="Delete application"
          >
            ✕
          </button>
```

And next to the other sheets:

```tsx
      <HistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        instance={instance}
        instanceColor={meta?.color ?? '#8b93a7'}
        name={name}
        history={status?.history ?? []}
        currentRevision={status?.sync?.revision}
      />

      <ConfirmSheet
        open={deleteOpen}
        title="Delete application"
        instance={instance}
        instanceColor={meta?.color ?? '#8b93a7'}
        app={name}
        body="Cascade delete: the application and every resource it manages are removed from the cluster."
        confirmLabel="Delete application"
        requireTyping
        onConfirm={async () => {
          await deleteApp(instance, name, true)
          await qc.invalidateQueries({ queryKey: ['apps'] })
          navigate('/')
        }}
        onClose={() => setDeleteOpen(false)}
      />
```

- [ ] **Step 3: Verify against a real instance**

Expected: History lists the last ten revisions newest first with commit messages where the repo allows it, the current one is labelled and has no rollback button; rolling back starts a sync to that revision; Delete only enables once the application name is typed exactly, and returns to the list afterwards.

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "feat(web): deployment history, rollback and guarded application delete"
```

---

### Task 17: Settings and the update path

**Files:**
- Create: `web/src/lib/update.ts`, `web/src/components/UpdateToast.tsx`
- Modify: `web/src/screens/Settings.tsx` (replace the stub), `web/src/App.tsx` (mount the toast)
- Test: `web/src/lib/update.test.ts`

**Interfaces:**
- Consumes: `useInstances` (Task 10), `useAuth` (Task 11), `/api/version` (Task 9).
- Produces: `isStale(serverVersion, bundleVersion)`, `watchForUpdates(onAvailable)`, `<UpdateToast />`, `Settings`.

- [ ] **Step 1: Write the failing staleness test**

Create `web/src/lib/update.test.ts`:

```ts
import { expect, test } from 'vitest'
import { isStale } from './update'

test('a different server version means this bundle is stale', () => {
  expect(isStale('1.4.0', '1.3.0')).toBe(true)
})

test('the same version is not stale', () => {
  expect(isStale('1.4.0', '1.4.0')).toBe(false)
})

test('unknown versions never trigger a reload loop', () => {
  expect(isStale('', '1.4.0')).toBe(false)
  expect(isStale('1.4.0', 'dev')).toBe(false)
  expect(isStale('dev', 'dev')).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && npm test`
Expected: FAIL — cannot resolve `./update`.

- [ ] **Step 3: Implement the update watcher**

Create `web/src/lib/update.ts`:

```ts
import { registerSW } from 'virtual:pwa-register'

/**
 * A build labelled `dev` is a local build, and an empty server version means
 * the check itself failed: neither must trigger a reload, or the app would
 * reload in a loop.
 */
export function isStale(serverVersion: string, bundleVersion: string): boolean {
  if (!serverVersion || bundleVersion === 'dev' || serverVersion === 'dev') return false
  return serverVersion !== bundleVersion
}

/**
 * Three independent mechanisms keep a client from getting stuck on an old
 * build: the service worker's own update check, an explicit periodic check on
 * load / foreground / every minute, and a comparison against the version the
 * server reports.
 */
export function watchForUpdates(onAvailable: (apply: () => void) => void): () => void {
  const applySW = registerSW({
    onNeedRefresh() {
      onAvailable(() => applySW(true))
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (navigator.onLine) void registration.update().catch(() => {})
      }
      check()
      const timer = window.setInterval(check, 60_000)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      window.addEventListener('beforeunload', () => window.clearInterval(timer))
    },
  })

  const pollVersion = async () => {
    try {
      const res = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' })
      const body = (await res.json()) as { version?: string }
      if (isStale(body.version ?? '', __BUILD_VERSION__)) {
        onAvailable(() => window.location.reload())
      }
    } catch {
      // Offline or mid-deploy: the next tick tries again.
    }
  }
  void pollVersion()
  const versionTimer = window.setInterval(pollVersion, 60_000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') void pollVersion()
  }
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearInterval(versionTimer)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd web && npm test`
Expected: PASS, 10 tests in total.

- [ ] **Step 5: Write the toast**

Create `web/src/components/UpdateToast.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { watchForUpdates } from '../lib/update'

/**
 * A new build is applied automatically, unless something is open that would
 * lose state — a sheet or a form. In that case the toast waits for a tap.
 */
export function UpdateToast() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  const applyRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const stop = watchForUpdates((fn) => {
      applyRef.current = fn
      setApply(() => fn)
      const busy = document.querySelector('[role="dialog"]') !== null
      if (!busy) {
        // Give React a tick to paint the toast before the reload.
        window.setTimeout(() => applyRef.current?.(), 400)
      }
    })
    return stop
  }, [])

  if (!apply) return null
  return (
    <div className="pb-safe fixed inset-x-3 bottom-20 z-[60] flex items-center gap-3 rounded-xl border border-accent bg-surface px-4 py-3 shadow-lg">
      <span className="flex-1 text-sm">A new version of MazeCD is available.</span>
      <button onClick={apply} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-bg">
        Reload
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Write the settings screen**

Replace `web/src/screens/Settings.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { useInstances } from '../api/queries'
import { api } from '../api/client'
import { useAuth } from '../lib/auth'

export function Settings() {
  const instances = useInstances()
  const { logout } = useAuth()
  const version = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<{ version: string }>('/api/version'),
    refetchInterval: false,
  })

  return (
    <div>
      <header className="pt-safe border-b border-border px-4 pb-3">
        <h1 className="text-xl font-semibold">Settings</h1>
      </header>

      <section className="p-4">
        <h2 className="text-sm font-medium text-muted">Instances</h2>
        <p className="mt-1 text-xs text-muted">
          Defined in the mounted configuration file. Editing them means updating the config and
          restarting MazeCD.
        </p>
        <ul className="mt-3 divide-y divide-border">
          {(instances.data ?? []).map((i) => (
            <li key={i.name} className="flex items-start gap-3 py-3">
              <span className="mt-1 h-8 w-1.5 shrink-0 rounded-full" style={{ background: i.color }} />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {i.name}
                  {i.production && <span className="ml-2 text-xs text-[#f4c030]">production</span>}
                </p>
                <p className="truncate text-xs text-muted">{i.url}</p>
                {i.error && <p className="mt-1 text-xs text-[#e96d76]">{i.error}</p>}
              </div>
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ background: i.reachable && i.tokenValid ? '#18be94' : '#e96d76' }}
                title={i.reachable && i.tokenValid ? 'Connected' : 'Unavailable'}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="p-4">
        <h2 className="text-sm font-medium text-muted">About</h2>
        <p className="mt-2 text-sm">
          Server build <span className="font-mono">{version.data?.version ?? '…'}</span>
        </p>
        <p className="text-sm">
          Client build <span className="font-mono">{__BUILD_VERSION__}</span>
        </p>
      </section>

      <section className="p-4">
        <button
          onClick={() => void logout()}
          className="h-12 w-full rounded-xl border border-border text-sm"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}
```

- [ ] **Step 7: Mount the toast**

In `web/src/App.tsx`, inside `Routed`, wrap the shell:

```tsx
  return (
    <>
      <Shell>
        <Routes>
          <Route path="/" element={<Apps />} />
          <Route path="/apps/:instance/:name" element={<AppDetailScreen />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
      <UpdateToast />
    </>
  )
```

with `import { UpdateToast } from './components/UpdateToast'`.

- [ ] **Step 8: Add the offline banner**

Create `web/src/lib/online.ts`:

```ts
import { useEffect, useState } from 'react'

/** Reflects navigator.onLine. Used to warn the operator and to disable
 * actions that would fail anyway. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}
```

In `web/src/components/Shell.tsx`, add `import { useOnline } from '../lib/online'`, call
`const online = useOnline()` in the component, and put the banner at the top of `main`:

```tsx
        {!online && (
          <div className="bg-[#3a2d1d] px-4 py-2 text-center text-sm">
            Offline — showing nothing newer than the last successful refresh.
          </div>
        )}
```

In `web/src/screens/AppDetail.tsx`, import the hook, call it, and extend the Sync
button's disabled condition so an action that cannot reach the server is not offered:

```tsx
            disabled={running || !online}
```

- [ ] **Step 9: Verify the update path for real**

```bash
cd web && MAZECD_VERSION=v1 npm run build && cd ..
go build -ldflags "-X main.version=v1" -o /tmp/mazecd ./cmd/mazecd
# run /tmp/mazecd with the dev env from Task 11, open the app, keep it open
cd web && MAZECD_VERSION=v2 npm run build && cd ..
go build -ldflags "-X main.version=v2" -o /tmp/mazecd ./cmd/mazecd
# restart the binary
```

Expected: the open client detects v2 within a minute (or immediately when brought back to the foreground) and reloads itself; after reloading, Settings shows `v2` for both client and server. Check in the browser devtools that `index.html` and `sw.js` were served with `Cache-Control: no-store` and `/assets/*` as `immutable`.

- [ ] **Step 10: Commit**

```bash
git add web/src
git commit -m "feat(web): settings screen, offline banner and three-layer update detection"
```

---

### Task 18: Container image, compose and documentation

**Files:**
- Create: `docker/Dockerfile`, `docker/compose.yaml`, `.dockerignore`, `config.example.yaml`, `README.md`, `web/public/icon-192.png`, `web/public/icon-512.png`
- Test: build and run the image

**Interfaces:**
- Consumes: the whole application.
- Produces: image `mazecd:dev` listening on 8080. MazeCD holds no state on disk — config and secrets come in through the environment and a read-only mount — so the image needs no writable directory and the container needs no volume.

- [ ] **Step 1: Generate the icons**

```bash
mkdir -p web/public
magick -size 512x512 xc:'#0b0e14' -fill '#6ea8fe' -pointsize 340 -font Helvetica-Bold \
  -gravity center -annotate 0 M web/public/icon-512.png
magick web/public/icon-512.png -resize 192x192 web/public/icon-192.png
```

If ImageMagick is unavailable, create the two PNGs by any means (they only need the right dimensions); the manifest references them by name.

- [ ] **Step 2: Write `.dockerignore`**

```
.git
web/node_modules
internal/web/dist
docs
*.md
```

- [ ] **Step 3: Write the Dockerfile**

Create `docker/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

FROM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ARG VERSION=dev
ENV MAZECD_VERSION=${VERSION}
# Vite writes to ../internal/web/dist, i.e. /src/internal/web/dist
RUN npm run build

FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY --from=web /src/internal/web/dist ./internal/web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/mazecd ./cmd/mazecd

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/mazecd /mazecd
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/mazecd"]
CMD ["serve"]
```

- [ ] **Step 4: Write the sample configuration**

Create `config.example.yaml`:

```yaml
# MazeCD configuration. Mount at /etc/mazecd/config.yaml (read-only).
# Tokens are referenced as ${VAR} and taken from the environment, so they can
# come from a Kubernetes secret and never sit in this file.
listen: ":8080"

instances:
  - name: prod
    url: https://argocd.prod.internal
    token: ${ARGOCD_TOKEN_PROD}
    color: "#ef4444"
    # Adds an extra confirmation step to sync and every destructive action.
    production: true
    # caCert: /certs/prod-ca.pem
    # insecureSkipVerify: false

  - name: dev
    url: https://argocd.dev.internal
    token: ${ARGOCD_TOKEN_DEV}
    color: "#3b82f6"
```

- [ ] **Step 5: Write the compose file**

Create `docker/compose.yaml`:

```yaml
services:
  mazecd:
    build:
      context: ..
      dockerfile: docker/Dockerfile
      args:
        VERSION: ${MAZECD_VERSION:-dev}
    image: mazecd:${MAZECD_VERSION:-dev}
    ports:
      - "8080:8080"
    environment:
      MAZECD_CONFIG: /etc/mazecd/config.yaml
      MAZECD_PASSWORD_HASH: ${MAZECD_PASSWORD_HASH:?run "mazecd hash" and export it}
      MAZECD_SESSION_KEY: ${MAZECD_SESSION_KEY:?run "openssl rand -base64 32" and export it}
      ARGOCD_TOKEN_PROD: ${ARGOCD_TOKEN_PROD:-}
      ARGOCD_TOKEN_DEV: ${ARGOCD_TOKEN_DEV:-}
    volumes:
      - ../config.yaml:/etc/mazecd/config.yaml:ro
    restart: unless-stopped
```

- [ ] **Step 6: Write the README**

Create `README.md`:

````markdown
# MazeCD

A mobile-first PWA for operating several ArgoCD instances from one screen:
one aggregated application list, full sync control, rollback, pod logs, and a
login you only do once.

## How it works

A single Go binary serves the API and the embedded PWA from the same origin.
It reads its instances from a mounted YAML file and reverse-proxies your
browser's requests to each ArgoCD API server with that instance's token
injected, so the tokens never reach the device and no CORS configuration is
needed on the ArgoCD side.

## Setup

### 1. Create an ArgoCD API token per instance

On each instance, add a local account and give it the permissions you want
MazeCD to have:

```yaml
# argocd-cm
data:
  accounts.mazecd: apiKey
```

```yaml
# argocd-rbac-cm
data:
  policy.csv: |
    p, role:mazecd, applications, get, */*, allow
    p, role:mazecd, applications, sync, */*, allow
    p, role:mazecd, applications, action/*, */*, allow
    p, role:mazecd, applications, delete, */*, allow
    p, role:mazecd, applications, override, */*, allow
    p, role:mazecd, logs, get, */*, allow
    g, mazecd, role:mazecd
```

Then generate the token:

```bash
argocd account generate-token --account mazecd
```

Grant only what you want to be able to do from your phone. Dropping
`delete` and `override` from the policy makes MazeCD read-plus-sync only —
the UI surfaces ArgoCD's own 403 for anything the token cannot do.

### 2. Write the configuration

Copy `config.example.yaml` to `config.yaml` and list your instances.

### 3. Generate the secrets

```bash
export MAZECD_PASSWORD_HASH="$(docker run --rm -i mazecd:dev hash <<< 'your-password')"
export MAZECD_SESSION_KEY="$(openssl rand -base64 32)"
export ARGOCD_TOKEN_PROD=...
```

### 4. Run

```bash
cd docker && docker compose up --build
```

Open http://localhost:8080 and sign in.

## Environment

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MAZECD_CONFIG` | no | `/etc/mazecd/config.yaml` | configuration file |
| `MAZECD_PASSWORD_HASH` | yes | — | bcrypt hash from `mazecd hash` |
| `MAZECD_SESSION_KEY` | yes | — | base64, ≥32 bytes, signs session cookies |
| `ARGOCD_TOKEN_*` | per instance | — | referenced from the config as `${VAR}` |

Rotating a token or adding an instance means updating the config or secret and
restarting the process: configuration is read once at startup.

## Serve it over HTTPS

The session cookie is `Secure` and the service worker requires a secure
context. `http://localhost` counts as secure for development; anywhere else,
put MazeCD behind TLS.

Do not expose MazeCD to the internet behind a proxy that hides the client
address without first adding trusted-proxy handling: login rate limiting keys
on the connecting address, so every client would share one bucket of five
attempts per fifteen minutes.

## Development

```bash
go test ./... -race            # backend
cd web && npm test             # frontend
cd web && npm run dev          # Vite on 5173, proxying /api to :8080
```

Run the backend with `MAZECD_CONFIG`, `MAZECD_PASSWORD_HASH` and
`MAZECD_SESSION_KEY` set; the PWA build is embedded from
`internal/web/dist`, which `npm run build` populates.

## What it deliberately does not do

No push notifications, no watch streams (it polls every 8 seconds in the
foreground), no ApplicationSet/Project/Repository administration, no
multi-user support, no terminal into pods, and no passkeys — the session lasts
90 days and renews itself, so a login is a twice-a-year event.
````

- [ ] **Step 7: Build and run the image**

```bash
docker build -f docker/Dockerfile -t mazecd:dev --build-arg VERSION=dev .
docker run --rm -i mazecd:dev hash <<< 'hunter2'
```

Expected: the build succeeds and the second command prints a bcrypt hash, proving the binary runs on distroless.

- [ ] **Step 8: Run the whole stack**

```bash
cp config.example.yaml config.yaml   # then edit it for a reachable instance
export MAZECD_PASSWORD_HASH="$(docker run --rm -i mazecd:dev hash <<< 'hunter2')"
export MAZECD_SESSION_KEY="$(openssl rand -base64 32)"
export ARGOCD_TOKEN_PROD=...
cd docker && docker compose up --build
```

Expected: http://localhost:8080 serves the PWA, login works, applications load, and the browser offers to install the app.

- [ ] **Step 9: Commit**

```bash
git add docker .dockerignore config.example.yaml README.md web/public
git commit -m "feat(docker): single-image build, compose stack and documentation"
```

---

### Task 19: Release workflow — multi-arch image on every merge to main

**Files:**
- Create: `.github/workflows/release.yml`, `.github/scripts/next-version.sh`
- Modify: `docker/Dockerfile` (cross-compilation), `README.md` (a Releases section)
- Test: run the version script against the real repository history

**Interfaces:**
- Consumes: `docker/Dockerfile` and the `VERSION` build arg from Task 18.
- Produces: `ghcr.io/amaze-labs/mazecd:vX.Y.Z` and `:latest` for `linux/amd64` and `linux/arm64`, plus a matching git tag, on every push to `main`.

Registry: GHCR, because `GITHUB_TOKEN` authenticates to it with no secret to configure. Swapping to another registry is three lines in the workflow.

Versioning rule, exactly as specified: a breaking change (`type!:` or a `BREAKING CHANGE` body) bumps major, a `feat:` bumps minor, and **everything else is a patch** — fixes, chores, docs, refactors, a commit with no conventional prefix at all. There is no "no release" case: every push to `main` publishes.

- [ ] **Step 1: Make the Dockerfile cross-compile instead of emulating**

The image must build for two architectures. Emulating an entire `npm ci` + `go build` under QEMU for arm64 costs roughly ten times a native build. Go cross-compiles natively, and the PWA is architecture-independent, so both builder stages should run on the runner's own architecture and only the final stage varies.

In `docker/Dockerfile`, pin both builder stages to the build platform and let the Go build target the requested architecture:

```dockerfile
FROM --platform=$BUILDPLATFORM node:26-alpine AS web
```

```dockerfile
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
```

and in the build stage, declare the target and use it:

```dockerfile
ARG VERSION=dev
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" -o /out/mazecd ./cmd/mazecd
```

`BUILDPLATFORM` and `TARGETARCH` are supplied by BuildKit; no other stage changes.

- [ ] **Step 2: Verify both architectures actually build**

```bash
docker buildx build --platform linux/amd64,linux/arm64 -f docker/Dockerfile --build-arg VERSION=test .
```

Expected: both platforms succeed. Confirm the Go build ran natively rather than under emulation — the arm64 leg should take about as long as the amd64 one, not minutes longer.

- [ ] **Step 3: Write the version script**

Create `.github/scripts/next-version.sh`:

```bash
#!/usr/bin/env bash
# Decides the next semantic version from the conventional commits since the
# last tag. Breaking -> major, feat -> minor, EVERYTHING else -> patch.
set -euo pipefail

last="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || true)"

if [ -z "$last" ]; then
  echo "version=v0.1.0"
  exit 0
fi

log="$(git log --format='%s%n%b' "${last}..HEAD")"
if [ -z "${log//[[:space:]]/}" ]; then
  # Nothing new since the last tag: re-running a workflow must not publish again.
  echo "version=${last}"
  echo "skip=true"
  exit 0
fi

version="${last#v}"
major="${version%%.*}"
rest="${version#*.}"
minor="${rest%%.*}"
patch="${rest#*.}"

if grep -qE '^[a-zA-Z]+(\([^)]*\))?!:' <<<"$log" || grep -qE '^BREAKING[ -]CHANGE' <<<"$log"; then
  major=$((major + 1)); minor=0; patch=0
elif grep -qE '^feat(\([^)]*\))?:' <<<"$log"; then
  minor=$((minor + 1)); patch=0
else
  patch=$((patch + 1))
fi

echo "version=v${major}.${minor}.${patch}"
echo "skip=false"
```

```bash
chmod +x .github/scripts/next-version.sh
```

- [ ] **Step 4: Check the script against real history**

```bash
./.github/scripts/next-version.sh
```

Expected on a repository with no tags yet: `version=v0.1.0`.

Then prove each branch of the rule, from a throwaway clone so the real repository is untouched:

```bash
tmp="$(mktemp -d)" && git clone -q . "$tmp" && cd "$tmp"
git tag v1.2.3
git commit -q --allow-empty -m "chore: tidy"        && ./.github/scripts/next-version.sh   # v1.2.4
git commit -q --allow-empty -m "feat: add a thing"  && ./.github/scripts/next-version.sh   # v1.3.0
git commit -q --allow-empty -m "feat!: break it"    && ./.github/scripts/next-version.sh   # v2.0.0
```

Also confirm a commit with no conventional prefix at all (`git commit --allow-empty -m "wip"`) produces a patch bump, since that is the stated rule, and that re-running with no new commits prints `skip=true`. Paste the actual output into the report.

- [ ] **Step 5: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: release

on:
  push:
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write
  packages: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # tags and full history: the version decision needs both

      - name: Decide the version
        id: version
        run: ./.github/scripts/next-version.sh >> "$GITHUB_OUTPUT"

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v6
        if: steps.version.outputs.skip != 'true'
        with:
          context: .
          file: docker/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          build-args: VERSION=${{ steps.version.outputs.version }}
          tags: |
            ghcr.io/${{ github.repository }}:${{ steps.version.outputs.version }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Tag the release
        if: steps.version.outputs.skip != 'true'
        run: |
          git tag "${{ steps.version.outputs.version }}"
          git push origin "${{ steps.version.outputs.version }}"
```

The tag is pushed only after the image is published, so a failed build leaves no tag claiming a release that does not exist — and the next run recomputes the same version rather than skipping it.

- [ ] **Step 6: Validate the workflow file**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml')); print('valid')"
```

Expected: `valid`. If `actionlint` is available, run it too and paste the output.

- [ ] **Step 7: Document it**

Add to `README.md`, after the Setup section:

````markdown
## Releases

Every push to `main` builds and publishes a multi-architecture image to GHCR:

```
ghcr.io/amaze-labs/mazecd:vX.Y.Z   # immutable
ghcr.io/amaze-labs/mazecd:latest
```

for `linux/amd64` and `linux/arm64`.

The version comes from the conventional commits since the last tag: a breaking
change (`feat!:`, or `BREAKING CHANGE` in the body) bumps the major, a `feat:`
bumps the minor, and everything else — fixes, chores, docs, refactors, commits
with no prefix — bumps the patch. The git tag is pushed only after the image
has been published.

The PWA updates itself: a running client notices the new build within a minute
of the deployment, or immediately when it next comes to the foreground.
````

- [ ] **Step 8: Commit**

```bash
git add .github docker/Dockerfile README.md
git commit -m "ci: publish multi-arch images to GHCR with conventional-commit versioning"
```


---

## Done means

- `go test ./... -race`, `go vet ./...`, `cd web && npm test` and `npm run build` all pass.
- `docker build` produces an image that serves the PWA and logs in.
- Against at least two real instances: the aggregated list shows both, sync with options works, refresh and hard refresh work, rollback works, pod logs stream, delete is guarded, and an unreachable instance degrades to a banner instead of an empty screen.
- Deploying a new build reloads an already-open client within a minute without clearing any cache by hand.
