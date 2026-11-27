package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChooseDataFolderPreservesOriginalAndLocksWrites(t *testing.T) {
	conf := t.TempDir()
	t.Setenv("APPDATA", conf)
	t.Setenv("QUADRA_DATA_DIR", "")
	t.Setenv("QUADRA_BACKUP_DIR", "")
	s, server := harness(t)
	oldDir := s.dir
	oldArchive, e := os.ReadFile(s.archive)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(s.att, "example.jpg"), []byte("illustrative"), 0600); e != nil {
		t.Fatal(e)
	}
	newDir := filepath.Join(t.TempDir(), "DataNew")
	body, _ := json.Marshal(map[string]string{"kind": "data", "path": newDir})
	status, response := call(t, server, "POST", "/api/storage/configure-folder", body, nil)
	require(t, 200, status, response)
	if _, e := os.Stat(filepath.Join(newDir, "allegati", "example.jpg")); e != nil {
		t.Fatal(e)
	}
	migrated, e := os.ReadFile(filepath.Join(newDir, "archivio.json"))
	if e != nil || string(oldArchive) != string(migrated) {
		t.Fatal("archive did not migrate intact")
	}
	if _, e := os.Stat(filepath.Join(oldDir, "archivio.json")); e != nil {
		t.Fatal("original archive deleted")
	}
	if _, e := os.Stat(filepath.Join(oldDir, "backup")); e != nil {
		t.Fatal("original backups deleted")
	}
	if cfg, e := readStorageConfig(); e != nil || cfg.DataDir != newDir {
		t.Fatalf("config not saved: %+v %v", cfg, e)
	}
	status, response = call(t, server, "GET", "/api/storage", nil, nil)
	require(t, 200, status, response)
	if !strings.Contains(string(response), `"restart_required":true`) {
		t.Fatal("restart must be required", string(response))
	}
	status, response = call(t, server, "PUT", "/api/state", oldArchive, nil)
	require(t, 423, status, response)
	newStore, e := makeStore(newDir)
	if e != nil {
		t.Fatal("new archive must be usable", e)
	}
	if _, e = newStore.read(); e != nil {
		t.Fatal(e)
	}
}

func TestChooseBackupFolderCopiesAndActivates(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("QUADRA_DATA_DIR", "")
	t.Setenv("QUADRA_BACKUP_DIR", "")
	s, server := harness(t)
	old := s.backup
	if e := os.WriteFile(filepath.Join(old, "quadra-test.json"), []byte("test"), 0600); e != nil {
		t.Fatal(e)
	}
	newer := filepath.Join(t.TempDir(), "NewBackups")
	body, _ := json.Marshal(map[string]string{"kind": "backup", "path": newer})
	code, response := call(t, server, "POST", "/api/storage/configure-folder", body, nil)
	require(t, 200, code, response)
	for _, path := range []string{filepath.Join(newer, "quadra-test.json"), filepath.Join(old, "quadra-test.json")} {
		if _, e := os.Stat(path); e != nil {
			t.Fatal("backup missing", path, e)
		}
	}
	if s.backup != newer {
		t.Fatal("backup folder not activated")
	}
	code, response = call(t, server, "POST", "/api/backup/save-to-folder", []byte("{}"), nil)
	require(t, 200, code, response)
	var result map[string]any
	if e := json.Unmarshal(response, &result); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(filepath.Join(newer, result["name"].(string))); e != nil {
		t.Fatal(e)
	}
	cfg, e := readStorageConfig()
	if e != nil || cfg.BackupDir != newer {
		t.Fatalf("config invalid %+v %v", cfg, e)
	}
}

func TestCannotOverwriteExistingOrUseInstallFolder(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("QUADRA_BACKUP_DIR", "")
	t.Setenv("QUADRA_DATA_DIR", "")
	s, h := harness(t)
	target := filepath.Join(t.TempDir(), "occupied")
	if e := os.MkdirAll(target, 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(target, "unrelated.txt"), []byte("private"), 0600); e != nil {
		t.Fatal(e)
	}
	for _, chosen := range []string{target, s.dir, filepath.Join(s.dir, "allegati"), filepath.Dir(os.Args[0])} {
		if !filepath.IsAbs(chosen) {
			continue
		}
		body, _ := json.Marshal(map[string]string{"kind": "data", "path": chosen})
		status, _ := call(t, h, "POST", "/api/storage/configure-folder", body, nil)
		if status == 200 {
			t.Fatalf("unsafe migration permitted to %s", chosen)
		}
	}
	if b, e := os.ReadFile(filepath.Join(target, "unrelated.txt")); e != nil || string(b) != "private" {
		t.Fatal("unrelated file altered")
	}
}
