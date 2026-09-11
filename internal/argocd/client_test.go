package argocd

import (
	"context"
	"errors"
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
