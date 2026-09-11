// Command mazecd serves the MazeCD API and PWA.
package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"golang.org/x/term"

	"github.com/amaze-labs/MazeCD/internal/auth"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "hash" {
		if err := runHash(); err != nil {
			fmt.Fprintln(os.Stderr, "mazecd hash:", err)
			os.Exit(1)
		}
		return
	}
	fmt.Fprintln(os.Stderr, "usage: mazecd [hash]")
	os.Exit(2)
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
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	return strings.TrimRight(line, "\r\n"), err
}
