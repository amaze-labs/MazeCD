package main

import (
	"strings"
	"testing"
)

func TestReadPasswordFromReaderWithoutNewline(t *testing.T) {
	input := strings.NewReader("hunter2")
	password, err := readPasswordFromReader(input)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if password != "hunter2" {
		t.Errorf("expected 'hunter2', got %q", password)
	}
}

func TestReadPasswordFromReaderWithNewline(t *testing.T) {
	input := strings.NewReader("hunter2\n")
	password, err := readPasswordFromReader(input)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if password != "hunter2" {
		t.Errorf("expected 'hunter2', got %q", password)
	}
}

func TestReadPasswordFromReaderWithCRLF(t *testing.T) {
	input := strings.NewReader("hunter2\r\n")
	password, err := readPasswordFromReader(input)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if password != "hunter2" {
		t.Errorf("expected 'hunter2', got %q", password)
	}
}

func TestReadPasswordFromReaderEmpty(t *testing.T) {
	input := strings.NewReader("")
	password, err := readPasswordFromReader(input)
	if err != nil {
		t.Errorf("unexpected error: %v", err)
	}
	if password != "" {
		t.Errorf("expected empty string, got %q", password)
	}
}
