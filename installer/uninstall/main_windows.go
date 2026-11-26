//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	mbYesNo        = 0x00000004
	mbIconQuestion = 0x00000020
	mbIconInfo     = 0x00000040
	mbIconError    = 0x00000010
	idYes          = 6
)

func dialog(body string, flags uintptr) int {
	u := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	b, _ := syscall.UTF16PtrFromString(body)
	title, _ := syscall.UTF16PtrFromString("Quadra - Disinstallazione")
	result, _, _ := u.Call(0, uintptr(unsafe.Pointer(b)), uintptr(unsafe.Pointer(title)), flags)
	return int(result)
}

func baseDir() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return "", fmt.Errorf("variabile LOCALAPPDATA non disponibile")
	}
	return filepath.Join(local, "Programs", "Quadra"), nil
}

func checkSameDir(p string) bool {
	expected, e := baseDir()
	if e != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(p), filepath.Clean(expected))
}

func runHidden(name string, args ...string) error {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if b, e := c.CombinedOutput(); e != nil {
		return fmt.Errorf("%s: %v: %s", name, e, strings.TrimSpace(string(b)))
	}
	return nil
}

func removeShortcuts(root string) {
	script := `param([string]$Root)
$ErrorActionPreference='Stop'
$shell=New-Object -ComObject WScript.Shell
$exe=Join-Path $Root 'Quadra.exe'
$programs=[Environment]::GetFolderPath('Programs')
$start=Join-Path $programs 'Quadra'
$desk=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Quadra.lnk'
function Remove-QuadraLink([string]$p,[string]$target) {
 if(Test-Path -LiteralPath $p) {
  try { $s=$shell.CreateShortcut($p); if([string]::Equals($s.TargetPath,$target,[StringComparison]::OrdinalIgnoreCase)) {Remove-Item -LiteralPath $p -Force}} catch {}
 }
}
Remove-QuadraLink $desk $exe
Remove-QuadraLink (Join-Path $start 'Quadra.lnk') $exe
Remove-QuadraLink (Join-Path $start 'Disinstalla Quadra.lnk') (Join-Path $Root 'Uninstall.exe')
if((Test-Path -LiteralPath $start) -and @((Get-ChildItem -LiteralPath $start -Force)).Count -eq 0) { Remove-Item -LiteralPath $start -Force }
`
	f, e := os.CreateTemp("", "quadra-remove-shortcuts-*.ps1")
	if e != nil {
		return
	}
	defer os.Remove(f.Name())
	_, _ = f.WriteString(script)
	_ = f.Close()
	_ = runHidden("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f.Name(), "-Root", root)
}

func perform(root string, silent bool) error {
	if !checkSameDir(root) {
		return fmt.Errorf("cartella di installazione non valida")
	}
	programFiles := []string{
		"Quadra.exe", "Quadra_diagnostica.exe", "Quadra.ico",
		"CREA_COLLEGAMENTO_DESKTOP.bat", "CONFIGURA_DATI_WINDOWS.bat",
		"CONFIGURA_DATI_WINDOWS.ps1", "LEGGIMI_PRIMA.txt",
		"Uninstall.exe",
	}
	// Never remove personal data, even if it was mistakenly stored near the executable.
	for _, name := range programFiles {
		p := filepath.Join(root, name)
		if _, e := os.Stat(p); os.IsNotExist(e) {
			continue
		}
		var err error
		for i := 0; i < 12; i++ {
			err = os.Remove(p)
			if err == nil || os.IsNotExist(err) {
				break
			}
			time.Sleep(350 * time.Millisecond)
		}
		if err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("impossibile rimuovere %s (chiudi Quadra e riprova): %v", name, err)
		}
	}
	removeShortcuts(root)
	_ = runHidden("reg.exe", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quadra`, "/f")
	_ = os.Remove(root) // succeeds only if empty; intentionally preserve unknown files
	if !silent {
		dialog("Quadra è stata disinstallata.\n\nI tuoi dati finanziari, gli allegati e i backup NON sono stati eliminati.\n\nRimangono nella cartella dati del tuo profilo Windows.", mbIconInfo)
	}
	return nil
}

func launchWorker() error {
	self, e := os.Executable()
	if e != nil {
		return e
	}
	tmp, e := os.CreateTemp(os.TempDir(), "quadra-uninstall-worker-*.exe")
	if e != nil {
		return e
	}
	src, e := os.Open(self)
	if e != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return e
	}
	_, e = io.Copy(tmp, src)
	src.Close()
	if e2 := tmp.Close(); e == nil {
		e = e2
	}
	if e != nil {
		os.Remove(tmp.Name())
		return e
	}
	root, e := baseDir()
	if e != nil {
		return e
	}
	args := []string{"--worker", root}
	for _, a := range os.Args[1:] {
		if a == "--quiet" {
			args = append(args, "--quiet")
		}
	}
	cmd := exec.Command(tmp.Name(), args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Start()
}

func scheduleDeleteSelf() {
	self, e := os.Executable()
	if e != nil {
		return
	}
	// Windows removes our temporary helper on the next reboot.
	mod := syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")
	ptr, e := syscall.UTF16PtrFromString(self)
	if e != nil {
		return
	}
	_, _, _ = mod.Call(uintptr(unsafe.Pointer(ptr)), 0, 4)
}

func main() {
	silent := false
	worker := len(os.Args) >= 3 && os.Args[1] == "--worker"
	for _, a := range os.Args[1:] {
		if a == "--quiet" {
			silent = true
		}
	}
	if worker {
		root := os.Args[2]
		// Wait for original uninstaller to exit before removing it.
		time.Sleep(1100 * time.Millisecond)
		err := perform(root, silent)
		if err != nil && !silent {
			dialog("Disinstallazione incompleta:\n"+err.Error(), mbIconError)
		}
		scheduleDeleteSelf()
		return
	}
	if _, e := baseDir(); e != nil {
		dialog(e.Error(), mbIconError)
		return
	}
	if !silent && dialog("Vuoi disinstallare Quadra dal PC?\n\nI dati finanziari, gli allegati e i backup rimarranno salvati.\nNon verranno mai eliminati automaticamente.", mbYesNo|mbIconQuestion) != idYes {
		return
	}
	if e := launchWorker(); e != nil {
		if !silent {
			dialog("Errore durante la disinstallazione:\n"+e.Error(), mbIconError)
		}
	}
}
