package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"testing"
	"time"
)

// TestServeWaitsForInFlightRequestOnShutdown reproduces the bug directly: a
// handler still writing its response when shutdown begins must be allowed to
// finish before serve returns, not cut off the moment the listener closes.
func TestServeWaitsForInFlightRequestOnShutdown(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	started := make(chan struct{})
	release := make(chan struct{})

	srv := &http.Server{
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(started)
			<-release // hold the response open, like a streaming log tail
			_, _ = w.Write([]byte("done"))
		}),
	}

	ctx, cancel := context.WithCancel(context.Background())
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- serve(srv, ctx, func() error { return srv.Serve(ln) })
	}()

	type result struct {
		body string
		err  error
	}
	clientDone := make(chan result, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String() + "/")
		if err != nil {
			clientDone <- result{err: err}
			return
		}
		defer resp.Body.Close()
		b, err := io.ReadAll(resp.Body)
		clientDone <- result{body: string(b), err: err}
	}()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("handler never started")
	}

	// Trigger shutdown while the handler is still blocked mid-response.
	cancel()

	// The connection is still active (the handler hasn't returned), so a
	// correct implementation cannot have returned from serve() yet: net/http's
	// Shutdown will not return while a connection is in StateActive, no
	// matter how the scheduler interleaves these goroutines. The buggy
	// version this guards against returns as soon as the listener closes --
	// a local operation that completes in microseconds -- so give it a
	// generous 200ms margin to prove it wrong reliably rather than racily.
	time.Sleep(200 * time.Millisecond)
	select {
	case err := <-serveDone:
		t.Fatalf("serve returned (err=%v) before the in-flight request finished", err)
	default:
	}

	close(release)

	var res result
	select {
	case res = <-clientDone:
	case <-time.After(2 * time.Second):
		t.Fatal("client never received a response")
	}
	if res.err != nil {
		t.Fatalf("client request failed: %v", res.err)
	}
	if res.body != "done" {
		t.Errorf("body = %q, want %q -- the in-flight response was cut off", res.body, "done")
	}

	select {
	case err := <-serveDone:
		if err != nil {
			t.Errorf("serve returned err = %v, want nil", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve did not return after shutdown completed")
	}
}

// TestServeReturnsImmediatelyOnListenError covers the other half of the
// contract: when listenAndServe fails for a reason other than a graceful
// shutdown (e.g. the port is already in use), ctx is never cancelled and the
// shutdown goroutine never fires, so serve must not wait on it.
func TestServeReturnsImmediatelyOnListenError(t *testing.T) {
	srv := &http.Server{}
	wantErr := errors.New("listen tcp: address already in use")

	done := make(chan error, 1)
	go func() {
		done <- serve(srv, context.Background(), func() error { return wantErr })
	}()

	select {
	case err := <-done:
		if !errors.Is(err, wantErr) {
			t.Errorf("err = %v, want %v", err, wantErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serve blocked instead of returning the listen error immediately")
	}
}
