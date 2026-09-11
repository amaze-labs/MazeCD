// Package auth handles the single-user application login and sessions.
package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost of 12 is roughly 250ms on current hardware: slow enough to make
// offline cracking of the stored hash expensive, fast enough for a login.
const bcryptCost = 12

// HashPassword returns an encoded bcrypt hash suitable for MAZECD_PASSWORD_HASH.
func HashPassword(password string) (string, error) {
	if password == "" {
		return "", errors.New("password is empty")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// VerifyPassword reports whether password matches the encoded hash. It is
// constant-time with respect to the password and never panics on a bad hash.
func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
