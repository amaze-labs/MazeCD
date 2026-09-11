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

func TestLimiterSweepsExpiredKeys(t *testing.T) {
	window := 15 * time.Minute
	l := NewLimiter(5, window)
	now := time.Now()

	// Record one attempt from each of 10 distinct keys at time now
	for i := 0; i < 10; i++ {
		key := "1.2.3." + string(rune('0'+i))
		if !l.Allow(key, now) {
			t.Fatalf("Allow failed for key %s", key)
		}
	}
	if len(l.hits) != 10 {
		t.Fatalf("after 10 calls, map has %d entries, want 10", len(l.hits))
	}

	// Advance time well past the window and call Allow with a new key.
	// This should trigger a sweep that deletes all stale keys from the first batch.
	futureTime := now.Add(2 * window)
	if !l.Allow("1.2.3.99", futureTime) {
		t.Fatal("Allow failed for new key")
	}

	// After sweep, only the newest key should remain.
	// All 10 old keys had timestamps at `now`, which is older than cutoff (futureTime - window).
	if len(l.hits) != 1 {
		t.Errorf("after sweep, map has %d entries, want 1", len(l.hits))
	}
}
