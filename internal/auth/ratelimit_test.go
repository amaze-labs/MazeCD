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
