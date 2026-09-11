// Command mazecd serves the MazeCD API and PWA.
package main

import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
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

	names := make([]string, 0, len(cfg.Instances))
	for _, i := range cfg.Instances {
		names = append(names, i.Name)
	}
	slog.Info("mazecd starting", "version", version, "listen", cfg.Listen, "instances", names)

	return serve(srv, ctx, srv.ListenAndServe)
}

// serve runs listenAndServe (srv.ListenAndServe in production) until ctx is
// cancelled, then waits for srv's graceful shutdown to actually finish before
// returning.
//
// Shutdown closes the listener immediately, which is exactly what makes
// ListenAndServe return http.ErrServerClosed -- long before Shutdown's own
// poll loop has waited out active connections. Returning as soon as
// ListenAndServe does (the previous bug here) lets the process exit while a
// response is still being written -- fatal for the pod log streams this
// server deliberately leaves without a WriteTimeout.
func serve(srv *http.Server, ctx context.Context, listenAndServe func() error) error {
	shutdownErr := make(chan error, 1)
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		shutdownErr <- srv.Shutdown(shutdownCtx)
	}()

	if err := listenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		// The server never shut down cleanly (e.g. the port was already in
		// use), so ctx may never be cancelled and the goroutine above may
		// never fire. Waiting on shutdownErr here could block forever.
		return err
	}
	// listenAndServe only returns ErrServerClosed once Shutdown has been
	// called, so the goroutine above is guaranteed to send.
	return <-shutdownErr
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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
	return readPasswordFromReader(os.Stdin)
}

// readPasswordFromReader reads a password from r, handling both newline-terminated
// and EOF-terminated input. It returns io.EOF as nil since EOF is a valid end-of-input
// marker when we've already read data.
func readPasswordFromReader(r io.Reader) (string, error) {
	line, err := bufio.NewReader(r).ReadString('\n')
	line = strings.TrimRight(line, "\r\n")
	if err == io.EOF {
		// EOF is OK as long as we have some data
		return line, nil
	}
	return line, err
}
