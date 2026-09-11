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

func TestLimiterSweepsEmptyEntries(t *testing.T) {
	window := 15 * time.Minute
	l := NewLimiter(5, window)
	now := time.Now()

	// Create entries from many distinct keys
	for i := 0; i < 10; i++ {
		key := "1.2.3." + string(rune('0'+i))
		l.Allow(key, now)
	}
	if len(l.hits) != 10 {
		t.Fatalf("after 10 calls, map has %d entries, want 10", len(l.hits))
	}

	// Simulate entries expiring by advancing time and then manually
	// trigger the sweep by calling Allow at a much later time
	futureTime := now.Add(2 * window)

	// Manually create expired entries in the map by reaching into unexported field
	// (test lives in same package, so this is allowed)
	for i := 0; i < 10; i++ {
		key := "1.2.3." + string(rune('0'+i))
		// Empty the slice - simulates all entries being expired and pruned
		l.hits[key] = l.hits[key][:0]
	}

	// Call Allow to trigger the sweep; this will prune entries (already empty)
	// and then sweep the map to delete empty entries
	l.Allow("1.2.3.99", futureTime)

	// After sweep, only the new key should remain
	if len(l.hits) != 1 {
		t.Errorf("after sweep, map has %d entries, want 1", len(l.hits))
	}
}
