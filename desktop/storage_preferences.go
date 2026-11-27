package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Directory preferences apply on restart, so a live session never changes
// the archive it is writing to or loses its directory lock.
type storagePreferences struct {
	DataDir string `json:"data_dir"`
	BackupRoot string `json:"backup_root"`
}

func readStoragePreferences() (storagePreferences, map[string]json.RawMessage, error) {
	var p storagePreferences
	fields := map[string]json.RawMessage{}
	raw, err := os.ReadFile(filepath.Join(userConfigDir(), "config.json"))
	if os.IsNotExist(err) { return p, fields, nil }
	if err != nil { return p, nil, err }
	if err = json.Unmarshal(raw, &fields); err != nil { return p, nil, err }
	if fields == nil { return p, nil, errors.New("configurazione non valida") }
	if err = json.Unmarshal(raw, &p); err != nil { return p, nil, err }
	return p, fields, nil
}

func writeStoragePreferences(p storagePreferences, fields map[string]json.RawMessage) error {
	for k, v := range map[string]string{"data_dir": p.DataDir, "backup_root": p.BackupRoot} {
		fields[k], _ = json.Marshal(v)
	}
	raw, err := json.MarshalIndent(fields, "", "  ")
	if err != nil { return err }
	dir := userConfigDir()
	if err = os.MkdirAll(dir, 0700); err != nil { return err }
	f, err := os.CreateTemp(dir, ".quadra-config-*")
	if err != nil { return err }
	defer os.Remove(f.Name())
	if _, err = f.Write(append(raw, '\n')); err == nil { err = f.Sync() }
	if closeErr := f.Close(); err == nil { err = closeErr }
	if err != nil { return err }
	return os.Rename(f.Name(), filepath.Join(dir, "config.json"))
}

func withinDirectory(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}

func selectedDirectory(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !filepath.IsAbs(value) { return "", errors.New("indica un percorso assoluto") }
	dir, err := filepath.EvalSymlinks(filepath.Clean(value))
	if err != nil { return "", err }
	info, err := os.Stat(dir)
	if err != nil { return "", err }
	if !info.IsDir() { return "", errors.New("il percorso non è una cartella") }
	exe, err := os.Executable()
	if err != nil { return "", err }
	program, err := filepath.EvalSymlinks(filepath.Dir(exe))
	if err != nil { return "", err }
	if withinDirectory(program, dir) {
		return "", errors.New("la cartella non può stare nella cartella del programma")
	}
	return dir, nil
}

// A separate directory per archive avoids rotating/deleting another archive's
// backups when the user chooses the same backup destination.
func configuredBackup(root, dataDir string) (string, error) {
	if root == "" { return filepath.Join(dataDir, "backup"), nil }
	root, err := selectedDirectory(root)
	if err != nil { return "", err }
	data, err := filepath.EvalSymlinks(dataDir)
	if err != nil { return "", err }
	if withinDirectory(data, root) { return "", errors.New("scegli una cartella di backup esterna all'archivio") }
	dir := filepath.Join(root, "Quadra-backup-"+sha([]byte(data))[:12])
	if err = os.MkdirAll(dir, 0700); err != nil { return "", err }
	info, err := os.Lstat(dir)
	if err != nil { return "", err }
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 { return "", errors.New("cartella backup non valida") }
	return dir, nil
}

func checkDataDestination(current, next string) error {
	if withinDirectory(current, next) || withinDirectory(next, current) {
		return errors.New("scegli una cartella separata dall'archivio attivo")
	}
	entries, err := os.ReadDir(next)
	if err != nil { return err }
	if len(entries) == 0 { return nil }
	// Never overwrite or initialize over an unrelated non-empty directory.
	candidate := &Store{dir:next, archive:filepath.Join(next,"archivio.json"), att:filepath.Join(next,"allegati"), stm:filepath.Join(next,"estratti")}
	unlock, err := lockDirectory(next)
	if err != nil { return fmt.Errorf("cartella già in uso: %w", err) }
	defer unlock()
	if _, err = candidate.backupBytes(); err != nil { return fmt.Errorf("scegli una cartella vuota o un archivio Quadra completo e valido: %w", err) }
	return nil
}

func (s *Store) storageSwitchBackup() (string, error) {
	raw, err := s.backupBytes()
	if err != nil { return "", err }
	name := filepath.Join(s.backup, "quadra-prima-cambio-cartella-"+time.Now().Format("20060102-150405")+"-"+randomID()+".zip")
	f, err := os.OpenFile(name, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil { return "", err }
	if _, err = f.Write(raw); err == nil { err = f.Sync() }
	if closeErr := f.Close(); err == nil { err = closeErr }
	if err != nil { _ = os.Remove(name); return "", err }
	return name, nil
}

func (a *Server) storageStatus() map[string]any {
	p, _, err := readStoragePreferences()
	next := p.DataDir
	if next == "" || a.dataDirOverride { next = a.store.dir }
	out := map[string]any{"data_dir": a.store.dir, "archive": a.store.archive, "separate_from_program":true,
		"backup_dir":a.store.backup, "next_data_dir":next, "backup_root":p.BackupRoot,
		"data_dir_override":a.dataDirOverride, "folder_picker":folderPickerAvailable()}
	if err != nil { out["config_error"] = err.Error() }
	return out
}

func (a *Server) configureStorage(w http.ResponseWriter, r *http.Request) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") { return httpError{415, "Content-Type JSON obbligatorio"} }
	raw, err := limited(r, 32768)
	if err != nil { return err }
	var req struct {
		DataDir string `json:"data_dir"`
		BackupRoot string `json:"backup_root"`
		ConfirmSwitch bool `json:"confirm_switch"`
	}
	if err = json.Unmarshal(raw, &req); err != nil { return bad("preferenze non valide") }
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	p, fields, err := readStoragePreferences()
	if err != nil { return err }
	active, err := filepath.EvalSymlinks(a.store.dir)
	if err != nil { return err }
	next, err := selectedDirectory(req.DataDir)
	if err != nil { return bad(err.Error()) }
	change := !(withinDirectory(active, next) && withinDirectory(next, active))
	if change {
		if a.dataDirOverride { return bad("la cartella dati è imposta da --data-dir o QUADRA_DATA_DIR") }
		if !req.ConfirmSwitch { return bad("conferma il cambio di archivio") }
		if err = checkDataDestination(active, next); err != nil { return bad(err.Error()) }
	}
	root := strings.TrimSpace(req.BackupRoot)
	if root != "" {
		root, err = selectedDirectory(root)
		if err != nil { return bad(err.Error()) }
		if withinDirectory(active, root) || withinDirectory(next, root) { return bad("scegli una cartella backup esterna all'archivio") }
		if _, err = configuredBackup(root, next); err != nil { return bad(err.Error()) }
	}
	safetyCopy := ""
	if change {
		safetyCopy, err = a.store.storageSwitchBackup()
		if err != nil { return fmt.Errorf("impossibile creare la copia di sicurezza: %w", err) }
	}
	if !a.dataDirOverride { p.DataDir = next }
	p.BackupRoot = root
	if err = writeStoragePreferences(p, fields); err != nil { return err }
	out := a.storageStatus()
	out["restart_required"] = true
	out["safety_copy"] = safetyCopy
	respond(w, 200, out)
	return nil
}
