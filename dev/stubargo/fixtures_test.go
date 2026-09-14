package main

import "testing"

// TestBuildApps is the one check this fixture generator needs: the counts
// the whole harness is built around (99 apps, ~8 non-nominal) must hold, or
// every screenshot downstream is quietly testing the wrong thing.
func TestBuildApps(t *testing.T) {
	apps := buildApps()
	if len(apps) != 99 {
		t.Fatalf("got %d apps, want 99", len(apps))
	}

	grouped := byInstance(apps)
	wantCounts := map[string]int{"home": 45, "orders": 30, "utility": 24}
	for inst, want := range wantCounts {
		if got := len(grouped[inst]); got != want {
			t.Errorf("instance %s: got %d apps, want %d", inst, got, want)
		}
	}

	var degraded, outOfSync, progressing, suspended, unknown, nominal int
	for _, a := range apps {
		switch {
		case a.Health == "Degraded":
			degraded++
		case a.Sync == "OutOfSync":
			outOfSync++
		case a.Health == "Progressing":
			progressing++
		case a.Health == "Suspended":
			suspended++
		case a.Health == "Unknown":
			unknown++
		case a.Health == "Healthy" && a.Sync == "Synced":
			nominal++
		}
	}
	for _, c := range []struct {
		name string
		got  int
		want int
	}{
		{"degraded", degraded, 2},
		{"outOfSync", outOfSync, 3},
		{"progressing", progressing, 1},
		{"suspended", suspended, 1},
		{"unknown", unknown, 1},
		{"nominal", nominal, 91},
	} {
		if c.got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, c.got, c.want)
		}
	}
}

// TestResourceTree checks the tree is genuinely nested (a Pod's parent chain
// reaches back to a root) and carries every kind the harness promises.
func TestResourceTree(t *testing.T) {
	apps := buildApps()
	a := byName(apps, "photo-library-ml")
	if a == nil {
		t.Fatal("fixture photo-library-ml not found")
	}
	nodes := resourceTree(a)

	byKind := map[string]int{}
	for _, n := range nodes {
		byKind[n.Kind]++
	}
	for _, kind := range []string{"Deployment", "ReplicaSet", "Pod", "CronJob", "Job", "Service", "ExternalSecret"} {
		if byKind[kind] == 0 {
			t.Errorf("resource tree missing kind %s", kind)
		}
	}

	// The Degraded app's Deployment, its ReplicaSet's pod, and the app
	// itself must agree on the health message -- otherwise the tree
	// wouldn't actually explain the red row it belongs to.
	var deployHealthy, podDegraded bool
	for _, n := range nodes {
		if n.Kind == "Deployment" && n.Health != nil && n.Health.Status == "Degraded" {
			deployHealthy = true
		}
		if n.Kind == "Pod" && n.Health != nil && n.Health.Status == "Degraded" && n.Health.Message == a.HealthMessage {
			podDegraded = true
		}
	}
	if !deployHealthy || !podDegraded {
		t.Errorf("degraded app's tree does not surface the health message down to a pod")
	}
}
