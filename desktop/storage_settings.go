package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// A folder must be chosen explicitly and must not overwrite an existing
// archive, a program directory, or an unrelated folder. The previous folder is
// intentionally left untouched so migration can be reversed manually.
func cleanChosenFolder(input string) (string, error) {
	input = strings.TrimSpace(os.ExpandEnv(input))
	if input == "" || !filepath.IsAbs(input) {
		return "", errors.New("scegli una cartella con percorso assoluto")
	}
	path := filepath.Clean(input)
	if filepath.Dir(path) == path {
		return "", errors.New("non scegliere la radice del disco")
	}
	if resolved, e := filepath.EvalSymlinks(path); e == nil {
		path = resolved
	}
	app, e := os.Executable()
	if e != nil {
		return "", e
	}
	program := filepath.Dir(app)
	if resolved, e := filepath.EvalSymlinks(program); e == nil {
		program = resolved
	}
	if pathWithin(path, program) {
		return "", errors.New("scegli una cartella esterna al programma Quadra")
	}
	if info, e := os.Stat(path); e == nil {
		if !info.IsDir() {
			return "", errors.New("il percorso scelto non è una cartella")
		}
	} else if !os.IsNotExist(e) {
		return "", e
	}
	return path, nil
}
func pathWithin(path, parent string) bool {
	path, parent = filepath.Clean(path), filepath.Clean(parent)
	rel, e := filepath.Rel(parent, path)
	return e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
func overlapping(path, other string) bool { return pathWithin(path, other) || pathWithin(other, path) }
func requireVacantFolder(path string) error {
	items, e := os.ReadDir(path)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	if len(items) > 0 {
		return errors.New("la cartella scelta non è vuota: crea una nuova cartella per evitare sovrascritture")
	}
	return nil
}
func verifyWritableDirectory(folder string) error {
	test, err := os.CreateTemp(folder, ".quadra-permission-*")
	if err != nil {
		return fmt.Errorf("cartella non scrivibile: %w", err)
	}
	defer os.Remove(test.Name())
	if err = test.Sync(); err != nil {
		test.Close()
		return err
	}
	return test.Close()
}
func copyFileChecked(src, dest string) error {
	original, err := os.Open(src)
	if err != nil {
		return err
	}
	defer original.Close()
	info, err := original.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("file non regolare: %s", filepath.Base(src))
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0700); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	_, err = io.Copy(io.MultiWriter(out, hash), original)
	if err == nil {
		err = out.Sync()
	}
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	verified, err := os.Open(dest)
	if err != nil {
		return err
	}
	defer verified.Close()
	check := sha256.New()
	if _, err = io.Copy(check, verified); err != nil {
		return err
	}
	if !strings.EqualFold(fmt.Sprintf("%x", hash.Sum(nil)), fmt.Sprintf("%x", check.Sum(nil))) {
		return errors.New("verifica di integrità fallita: " + filepath.Base(src))
	}
	return nil
}
func copyFolderChecked(from, to string) (int, error) {
	if _, err := os.Stat(from); os.IsNotExist(err) {
		return 0, nil
	} else if err != nil {
		return 0, err
	}
	count := 0
	err := filepath.WalkDir(from, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		target := filepath.Join(to, rel)
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("collegamenti simbolici non consentiti nell'archivio")
		}
		if entry.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		if err = copyFileChecked(path, target); err != nil {
			return err
		}
		count++
		return nil
	})
	return count, err
}
func (a *Server) storageDetails() map[string]any {
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	return map[string]any{
		"data_dir":                   a.store.dir,
		"backup_dir":                 a.store.backup,
		"archive":                    a.store.archive,
		"separate_from_program":      true,
		"directory_picker_available": folderPickerAvailable(),
		"restart_required":           a.restartRequired.Load(),
		"pending_data_dir":           a.pendingDataDir,
		"data_dir_locked":            a.lockedDataDir,
	}
}
func (a *Server) configureFolder(kind, chosen string) (map[string]any, error) {
	target, err := cleanChosenFolder(chosen)
	if err != nil {
		return nil, bad(err.Error())
	}
	s := a.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if a.restartRequired.Load() {
		return nil, httpError{423, "chiudi e riapri Quadra prima di modificare altri percorsi"}
	}
	cfg, err := readStorageConfig()
	if err != nil {
		return nil, err
	}
	switch kind {
	case "backup":
		if os.Getenv("QUADRA_BACKUP_DIR") != "" {
			return nil, bad("il percorso backup è gestito dalla variabile QUADRA_BACKUP_DIR")
		}
		if overlapping(target, s.backup) || target == s.dir || pathWithin(s.dir, target) || pathWithin(target, s.att) || pathWithin(target, s.stm) {
			return nil, bad("scegli una nuova cartella backup distinta da quella corrente e dai documenti")
		}
		if err = requireVacantFolder(target); err != nil {
			return nil, bad(err.Error())
		}
		if err = os.MkdirAll(target, 0700); err != nil {
			return nil, err
		}
		if err = verifyWritableDirectory(target); err != nil {
			return nil, err
		}
		moved, err := copyFolderChecked(s.backup, target)
		if err != nil {
			return nil, fmt.Errorf("copia backup incompleta; cartella precedente intatta: %w", err)
		}
		cfg.BackupDir = target
		if err = writeStorageConfig(cfg); err != nil {
			return nil, err
		}
		s.backup = target
		return map[string]any{"ok": true, "backup_dir": target, "files_copied": moved, "restart_required": false}, nil
	case "data":
		if a.lockedDataDir {
			return nil, bad("percorso dati gestito da --data-dir o QUADRA_DATA_DIR: chiudi e riavvia Quadra normalmente")
		}
		if overlapping(target, s.dir) || overlapping(target, s.backup) {
			return nil, bad("scegli una cartella nuova, separata dai dati e dai backup attuali")
		}
		if err = requireVacantFolder(target); err != nil {
			return nil, bad(err.Error())
		}
		// A complete verified backup is saved before the migration begins.
		if _, err = s.saveCompleteBackup("quadra-prima-cambio-cartella-"); err != nil {
			return nil, fmt.Errorf("backup di sicurezza non riuscito: %w", err)
		}
		if err = os.MkdirAll(target, 0700); err != nil {
			return nil, err
		}
		if err = verifyWritableDirectory(target); err != nil {
			return nil, err
		}
		if err = copyFileChecked(s.archive, filepath.Join(target, "archivio.json")); err != nil {
			return nil, err
		}
		moved := 1
		for _, folder := range []string{"allegati", "estratti"} {
			count, er := copyFolderChecked(filepath.Join(s.dir, folder), filepath.Join(target, folder))
			if er != nil {
				return nil, fmt.Errorf("copia %s incompleta: %w", folder, er)
			}
			moved += count
		}
		// Only in-tree backups travel with the archive. A separately configured
		// backup folder stays where it is unless the user changes it separately.
		if pathWithin(s.backup, s.dir) {
			rel, _ := filepath.Rel(s.dir, s.backup)
			count, er := copyFolderChecked(s.backup, filepath.Join(target, rel))
			if er != nil {
				return nil, fmt.Errorf("copia backup incompleta: %w", er)
			}
			moved += count
			if cfg.BackupDir != "" {
				cfg.BackupDir = filepath.Join(target, rel)
			}
		}
		if _, err = (&Store{archive: filepath.Join(target, "archivio.json")}).read(); err != nil {
			return nil, fmt.Errorf("archivio copiato non valido: %w", err)
		}
		cfg.DataDir = target
		if err = writeStorageConfig(cfg); err != nil {
			return nil, err
		}
		a.pendingDataDir = target
		a.restartRequired.Store(true)
		return map[string]any{"ok": true, "data_dir": target, "files_copied": moved, "restart_required": true}, nil
	default:
		return nil, bad("tipo di cartella non valido")
	}
}
func (s *Store) saveCompleteBackup(prefix string) (map[string]any, error) {
	b, err := s.backupBytes()
	if err != nil {
		return nil, err
	}
	name := prefix + time.Now().Format("20060102-150405.000000") + ".zip"
	full := filepath.Join(s.backup, name)
	f, err := os.OpenFile(full, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(full)
		return nil, err
	}
	return map[string]any{"ok": true, "name": name, "path": full, "size": len(b)}, nil
}
