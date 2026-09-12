// Package config loads the MazeCD instance configuration from a YAML file.
package config

import (
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"

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
		// Normalize here, once, because the two consumers join this base
		// differently: the proxy concatenates the path, the API client uses
		// JoinPath. A trailing slash -- perfectly natural to write -- would
		// otherwise send every proxied request to //api/v1/... while the
		// aggregated list and the health probe kept working.
		u.Path = strings.TrimSuffix(u.Path, "/")
		u.RawPath, u.RawQuery, u.Fragment = "", "", ""
		inst.URL = u.String()
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
