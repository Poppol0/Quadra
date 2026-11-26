//go:build windows

package main

import (
	"archive/zip"
	"bytes"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed payload.zip QuadraUninstall.exe
var bundled embed.FS

const (
	appVersion     = "1.0.0"
	mbYesNo        = 0x00000004
	mbYesNoCancel  = 0x00000003
	mbIconInfo     = 0x00000040
	mbIconQuestion = 0x00000020
	mbIconError    = 0x00000010
	idYes          = 6
	idNo           = 7
	idCancel       = 2
)

var allowed = map[string]bool{
	"Quadra.exe": true, "Quadra_diagnostica.exe": true, "Quadra.ico": true,
	"LEGGIMI_PRIMA.txt": true, "CREA_COLLEGAMENTO_DESKTOP.bat": true,
	"CONFIGURA_DATI_WINDOWS.bat": true, "CONFIGURA_DATI_WINDOWS.ps1": true,
}

func message(title, body string, flags uintptr) int {
	f := syscall.NewLazyDLL("user32.dll").NewProc("MessageBoxW")
	a, _ := syscall.UTF16PtrFromString(body)
	b, _ := syscall.UTF16PtrFromString(title)
	c, _, _ := f.Call(0, uintptr(unsafe.Pointer(a)), uintptr(unsafe.Pointer(b)), flags)
	return int(c)
}
func dialog(body string, flags uintptr) int { return message("Quadra - Installazione", body, flags) }

func installPath() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return "", errors.New("LOCALAPPDATA non disponibile: installazione riservata a Windows 10/11")
	}
	return filepath.Join(local, "Programs", "Quadra"), nil
}
func dataPath() (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return "", errors.New("LOCALAPPDATA non disponibile")
	}
	return filepath.Join(local, "Quadra"), nil
}
func runHidden(name string, args ...string) ([]byte, error) {
	c := exec.Command(name, args...)
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return c.CombinedOutput()
}
func ensureClosed() error {
	b, e := runHidden("tasklist.exe", "/FI", "IMAGENAME eq Quadra.exe", "/FO", "CSV", "/NH")
	if e == nil && strings.Contains(strings.ToLower(string(b)), "quadra.exe") {
		return errors.New("Quadra risulta aperta. Chiudi completamente la finestra di Quadra e ripeti l'installazione")
	}
	b, e = runHidden("tasklist.exe", "/FI", "IMAGENAME eq Quadra_diagnostica.exe", "/FO", "CSV", "/NH")
	if e == nil && strings.Contains(strings.ToLower(string(b)), "quadra_diagnostica.exe") {
		return errors.New("Chiudi anche Quadra_diagnostica.exe prima di installare")
	}
	return nil
}
func checkFolder(root string) error {
	// Guard against a custom data directory inside our program directory,
	// even if the program directory does not yet exist.
	if base := os.Getenv("APPDATA"); base != "" {
		raw, e := os.ReadFile(filepath.Join(base, "Quadra", "config.json"))
		if e == nil {
			var config struct {
				DataDir string `json:"data_dir"`
			}
			if json.Unmarshal(raw, &config) == nil && config.DataDir != "" {
				candidate := strings.ToLower(filepath.Clean(os.ExpandEnv(config.DataDir)))
				program := strings.ToLower(filepath.Clean(root))
				if candidate == program || strings.HasPrefix(candidate, program+string(filepath.Separator)) {
					return errors.New("la cartella dati personalizzata è all'interno della cartella del programma: spostala prima di installare")
				}
			}
		}
	}
	names, e := os.ReadDir(root)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	for _, info := range names {
		if info.IsDir() || (!allowed[info.Name()] && info.Name() != "Uninstall.exe") {
			return fmt.Errorf("la cartella %s contiene file non riconosciuti (%s): per sicurezza non verrà modificata", root, info.Name())
		}
	}
	return nil
}

func extractArchive(dst string) (int64, error) {
	raw, e := bundled.ReadFile("payload.zip")
	if e != nil {
		return 0, e
	}
	r, e := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if e != nil {
		return 0, e
	}
	seen := map[string]bool{}
	var total int64
	for _, item := range r.File {
		if !allowed[item.Name] || seen[item.Name] || item.FileInfo().IsDir() || (item.Mode()&os.ModeSymlink) != 0 {
			return 0, fmt.Errorf("file non consentito nel pacchetto: %s", item.Name)
		}
		if item.UncompressedSize64 > 20*1024*1024 {
			return 0, fmt.Errorf("dimensione eccessiva: %s", item.Name)
		}
		seen[item.Name] = true
		reader, e := item.Open()
		if e != nil {
			return 0, e
		}
		p := filepath.Join(dst, item.Name)
		output, e := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			reader.Close()
			return 0, e
		}
		n, err := io.Copy(output, io.LimitReader(reader, int64(item.UncompressedSize64)+1))
		if e := output.Sync(); err == nil {
			err = e
		}
		if e := output.Close(); err == nil {
			err = e
		}
		reader.Close()
		if err != nil {
			return 0, err
		}
		if n != int64(item.UncompressedSize64) {
			return 0, fmt.Errorf("file incompleto: %s", item.Name)
		}
		total += n
	}
	for _, required := range []string{"Quadra.exe", "Quadra.ico", "LEGGIMI_PRIMA.txt"} {
		if !seen[required] {
			return 0, fmt.Errorf("file mancante nel pacchetto: %s", required)
		}
	}
	return total, nil
}

const shortcutsPS = `param([string]$Root,[string]$Desktop)
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$programs = [Environment]::GetFolderPath('Programs')
$startFolder = Join-Path $programs 'Quadra'
[IO.Directory]::CreateDirectory($startFolder) | Out-Null
function Make-QuadraShortcut([string]$Location,[string]$Target,[string]$Desc) {
 $s = $shell.CreateShortcut($Location)
 $s.TargetPath = $Target
 $s.WorkingDirectory = $Root
 $s.IconLocation = (Join-Path $Root 'Quadra.ico') + ',0'
 $s.Description = $Desc
 $s.Save()
}
Make-QuadraShortcut (Join-Path $startFolder 'Quadra.lnk') (Join-Path $Root 'Quadra.exe') 'Quadra - I conti di casa, in ordine'
Make-QuadraShortcut (Join-Path $startFolder 'Disinstalla Quadra.lnk') (Join-Path $Root 'Uninstall.exe') 'Disinstalla Quadra senza eliminare i dati'
if ($Desktop -eq '1') {
  $desktopDir = [Environment]::GetFolderPath('Desktop')
  Make-QuadraShortcut (Join-Path $desktopDir 'Quadra.lnk') (Join-Path $Root 'Quadra.exe') 'Quadra - I conti di casa, in ordine'
}
`

func createShortcuts(root string, desktop bool) error {
	f, e := os.CreateTemp("", "quadra-shortcuts-*.ps1")
	if e != nil {
		return e
	}
	defer os.Remove(f.Name())
	_, e = f.WriteString(shortcutsPS)
	if e2 := f.Close(); e == nil {
		e = e2
	}
	if e != nil {
		return e
	}
	arg := "0"
	if desktop {
		arg = "1"
	}
	out, e := runHidden("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", f.Name(), "-Root", root, "-Desktop", arg)
	if e != nil {
		return fmt.Errorf("%w: %s", e, strings.TrimSpace(string(out)))
	}
	return nil
}
func regSet(name, typ, value string) error {
	base := `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Quadra`
	out, e := runHidden("reg.exe", "add", base, "/v", name, "/t", typ, "/d", value, "/f")
	if e != nil {
		return fmt.Errorf("voce %s: %v: %s", name, e, strings.TrimSpace(string(out)))
	}
	return nil
}
func register(root string, installedSize int64) error {
	uninstaller := filepath.Join(root, "Uninstall.exe")
	commands := []struct{ name, typ, value string }{
		{"DisplayName", "REG_SZ", "Quadra Desktop"},
		{"DisplayVersion", "REG_SZ", appVersion},
		{"Publisher", "REG_SZ", "Quadra"},
		{"InstallLocation", "REG_SZ", root},
		{"DisplayIcon", "REG_SZ", filepath.Join(root, "Quadra.exe")},
		{"UninstallString", "REG_SZ", strconv.Quote(uninstaller)},
		{"QuietUninstallString", "REG_SZ", strconv.Quote(uninstaller) + " --quiet"},
		{"EstimatedSize", "REG_DWORD", strconv.FormatInt((installedSize+1023)/1024, 10)},
		{"NoModify", "REG_DWORD", "1"},
		{"NoRepair", "REG_DWORD", "1"},
	}
	for _, c := range commands {
		if err := regSet(c.name, c.typ, c.value); err != nil {
			return err
		}
	}
	return nil
}
func deploy(root string) (int64, error) {
	parent := filepath.Dir(root)
	if e := os.MkdirAll(parent, 0700); e != nil {
		return 0, e
	}
	stage, e := os.MkdirTemp(parent, ".Quadra-install-")
	if e != nil {
		return 0, e
	}
	defer os.RemoveAll(stage)
	size, e := extractArchive(stage)
	if e != nil {
		return 0, e
	}
	uninstall, e := bundled.ReadFile("QuadraUninstall.exe")
	if e != nil {
		return 0, e
	}
	path := filepath.Join(stage, "Uninstall.exe")
	if e = os.WriteFile(path, uninstall, 0700); e != nil {
		return 0, e
	}
	size += int64(len(uninstall))
	if e = checkFolder(root); e != nil {
		return 0, e
	}
	backup := ""
	if _, e = os.Stat(root); e == nil {
		backup = filepath.Join(parent, ".Quadra-programma-prec-"+time.Now().Format("20060102-150405.000000000"))
		if e = os.Rename(root, backup); e != nil {
			return 0, fmt.Errorf("chiudi Quadra prima di aggiornare: %w", e)
		}
	} else if !os.IsNotExist(e) {
		return 0, e
	}
	if e = os.Rename(stage, root); e != nil {
		if backup != "" {
			_ = os.Rename(backup, root)
		}
		return 0, fmt.Errorf("impossibile completare l'installazione (ripristino tentato): %w", e)
	}
	if backup != "" { // Old files are program-only: they have passed checkFolder.
		if err := os.RemoveAll(backup); err != nil {
			return size, fmt.Errorf("Quadra è installata, ma non è stato possibile pulire la vecchia cartella %s: %w", backup, err)
		}
	}
	return size, nil
}
func main() {
	silent := false
	desktop := true
	for _, v := range os.Args[1:] {
		if v == "--quiet" {
			silent = true
			desktop = false
		}
		if v == "--desktop" {
			desktop = true
		}
	}
	root, e := installPath()
	if e != nil {
		dialog(e.Error(), mbIconError)
		return
	}
	data, _ := dataPath()
	if !silent {
		text := "Benvenuto in Quadra Desktop.\n\nIl programma sarà installato in:\n" + root + "\n\nI dati finanziari resteranno separati in:\n" + data + "\n\nIl tuo archivio, le ricevute e i backup non saranno modificati.\n\nVuoi continuare?"
		if dialog(text, mbYesNo|mbIconQuestion) != idYes {
			return
		}
		switch dialog("Vuoi creare anche un collegamento Quadra sul Desktop?\n\nSì: Desktop e menu Start\nNo: solo menu Start\nAnnulla: esci dall'installazione", mbYesNoCancel|mbIconQuestion) {
		case idYes:
			desktop = true
		case idNo:
			desktop = false
		default:
			return
		}
	}
	if e = ensureClosed(); e != nil {
		if !silent {
			dialog(e.Error(), mbIconError)
		}
		os.Exit(2)
	}
	size, e := deploy(root)
	if e != nil {
		if !silent {
			dialog("Installazione non completata:\n"+e.Error(), mbIconError)
		}
		os.Exit(3)
	}
	notes := []string{}
	if e = createShortcuts(root, desktop); e != nil {
		notes = append(notes, "Impossibile creare tutti i collegamenti: "+e.Error())
	}
	if e = register(root, size); e != nil {
		notes = append(notes, "Impossibile registrare correttamente l'app nelle impostazioni di Windows: "+e.Error())
	}
	if !silent {
		text := "Quadra Desktop è stata installata.\n\nLa puoi avviare dal menu Start cercando 'Quadra'.\n\nI dati personali non sono stati toccati."
		if len(notes) > 0 {
			text += "\n\nAvvisi:\n" + strings.Join(notes, "\n")
		}
		text += "\n\nVuoi avviare Quadra adesso?"
		if dialog(text, mbYesNo|mbIconInfo) == idYes {
			c := exec.Command(filepath.Join(root, "Quadra.exe"))
			_ = c.Start()
		}
	}
}
