package auth

import "testing"

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == "correct horse battery staple" {
		t.Fatal("password stored in clear")
	}
	if !VerifyPassword(hash, "correct horse battery staple") {
		t.Error("correct password rejected")
	}
	if VerifyPassword(hash, "wrong") {
		t.Error("wrong password accepted")
	}
}

func TestVerifyRejectsGarbageHash(t *testing.T) {
	if VerifyPassword("", "anything") {
		t.Error("empty hash accepted a password")
	}
	if VerifyPassword("not-a-bcrypt-hash", "anything") {
		t.Error("malformed hash accepted a password")
	}
}

func TestHashRejectsEmptyPassword(t *testing.T) {
	if _, err := HashPassword(""); err == nil {
		t.Error("expected an error for an empty password")
	}
}
