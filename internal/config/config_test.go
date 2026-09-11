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
