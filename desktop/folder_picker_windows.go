//go:build windows

package main

import (
	"errors"
	"os/exec"
	"strings"
	"syscall"
)

func folderPickerAvailable() bool { return true }
func pickFolder(current, kind string) (string, error) {
	caption := "Seleziona cartella dati Quadra"
	if kind == "backup" {
		caption = "Seleziona cartella backup Quadra"
	}
	// Every interpolated value comes from a server-controlled local path; quote
	// single quotes for the PowerShell string literal as an additional guard.
	escape := func(s string) string { return strings.ReplaceAll(s, "'", "''") }
	script := `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; ` +
		`$dlg = New-Object System.Windows.Forms.FolderBrowserDialog; ` +
		`$dlg.Description = '` + escape(caption) + `'; ` +
		`$dlg.ShowNewFolderButton = $true; ` +
		`$start = '` + escape(current) + `'; ` +
		`if ([System.IO.Directory]::Exists($start)) { $dlg.SelectedPath = $start }; ` +
		`if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($dlg.SelectedPath) }`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-Sta", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return "", errors.New("selezione cartella Windows non disponibile: " + err.Error())
	}
	return strings.TrimSpace(strings.TrimPrefix(string(out), "\ufeff")), nil
}
