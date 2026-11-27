//go:build windows

package main

import (
	"context"
	"errors"
	"strings"
	"time"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func edgeExecutable() string {
	candidates := []string{}
	for _, env := range []string{"PROGRAMFILES(X86)", "ProgramFiles", "LOCALAPPDATA"} {
		base := os.Getenv(env)
		if base == "" {
			continue
		}
		candidates = append(candidates, filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
	}
	if found, err := exec.LookPath("msedge.exe"); err == nil {
		candidates = append(candidates, found)
	}
	for _, p := range candidates {
		if info, e := os.Stat(p); e == nil && !info.IsDir() {
			return p
		}
	}
	return ""
}
func runWindow(url, dataDir string) error {
	edge := edgeExecutable()
	if edge == "" {
		return errors.New("Microsoft Edge non è installato. Quadra Desktop usa la finestra applicazione di Edge: installa Edge o utilizza la versione browser locale.")
	}
	browserDir := filepath.Join(dataDir, "desktop-browser")
	if e := os.MkdirAll(browserDir, 0700); e != nil {
		return e
	}
	cmd := exec.Command(edge, "--app="+url, "--user-data-dir="+browserDir, "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--window-size=1370,900")
	cmd.Stdin = nil
	if e := cmd.Start(); e != nil {
		return e
	}
	// Isolated Edge profile keeps the application process independent of the user's normal browser.
	// When the app window is closed, its process exits and Quadra releases the data lock.
	return cmd.Wait()
}
func showError(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	call := user32.NewProc("MessageBoxW")
	content, _ := syscall.UTF16PtrFromString(msg)
	title, _ := syscall.UTF16PtrFromString("Quadra Desktop")
	_, _, _ = call.Call(0, uintptr(unsafe.Pointer(content)), uintptr(unsafe.Pointer(title)), 0x10)
}
func lockDirectory(path string) (func(), error) {
	f, e := os.OpenFile(filepath.Join(path, ".quadra-active.lock"), os.O_RDWR|os.O_CREATE, 0600)
	if e != nil {
		return nil, e
	}
	k := syscall.NewLazyDLL("kernel32.dll")
	proc := k.NewProc("LockFileEx")
	overlapped := new(syscall.Overlapped)
	ok, _, errno := proc.Call(f.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(overlapped)))
	if ok == 0 {
		_ = f.Close()
		if errno != nil {
			return nil, errno
		}
		return nil, errors.New("archivio già in uso")
	}
	return func() { _ = f.Close() }, nil
}

func folderPickerAvailable() bool { return true }

// Fixed PowerShell program; no user-controlled path is interpolated as code.
func pickFolder(ctx context.Context) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	script := `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Seleziona la cartella per Quadra'
$d.ShowNewFolderButton = $true
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
try {
  if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($d.SelectedPath)
  }
} finally { $d.Dispose(); $owner.Dispose() }`
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-STA", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow:true}
	out, err := cmd.Output()
	if err != nil { return "", errors.New("selettore cartella non disponibile; inserisci il percorso manualmente") }
	return strings.TrimSpace(string(out)), nil
}
