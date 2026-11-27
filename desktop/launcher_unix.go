//go:build !windows

package main

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

func runWindow(_ string, _ string) error {
	return errors.New("finestra desktop disponibile nell'eseguibile Windows; per i test usa --serve-only")
}
func showError(msg string) { println(msg) }
func lockDirectory(path string) (func(), error) {
	f, e := os.OpenFile(filepath.Join(path, ".quadra-active.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		_ = f.Close()
		return nil, e
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }, nil
}
