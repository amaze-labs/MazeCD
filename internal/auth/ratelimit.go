package auth

import (
	"sync"
	"time"
)

// Limiter is a fixed-window attempt counter keyed by client.
// ponytail: one mutex and a map; the login endpoint of a single-user app will
// never see the contention that would justify anything sharded.
type Limiter struct {
	mu        sync.Mutex
	max       int
	window    time.Duration
	hits      map[string][]time.Time
	lastSweep time.Time
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

	allowed := true
	if len(kept) >= l.max {
		l.hits[key] = kept
		allowed = false
	} else {
		l.hits[key] = append(kept, now)
	}

	// Opportunistic sweep: delete empty entries once per window to prevent unbounded map growth.
	if now.Sub(l.lastSweep) >= l.window {
		for k, v := range l.hits {
			if len(v) == 0 {
				delete(l.hits, k)
			}
		}
		l.lastSweep = now
	}

	return allowed
}
