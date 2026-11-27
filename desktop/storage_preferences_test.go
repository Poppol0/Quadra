package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoragePreferences(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	s, h := harness(t)
	root := t.TempDir()
	next := t.TempDir()
	payload, _ := json.Marshal(map[string]any{"data_dir":next, "backup_root":root, "confirm_switch":false})
	headers := map[string]string{"Content-Type":"application/json"}
	code, b := call(t,h,"PUT","/api/storage",payload,headers)
	require(t,400,code,b)
	payload, _ = json.Marshal(map[string]any{"data_dir":next, "backup_root":root, "confirm_switch":true})
	code, b = call(t,h,"PUT","/api/storage",payload,headers)
	require(t,200,code,b)
	var result map[string]any
	if err := json.Unmarshal(b,&result); err != nil { t.Fatal(err) }
	if result["data_dir"] != s.dir || result["restart_required"] != true { t.Fatal(result) }
	backup, ok := result["safety_copy"].(string)
	if !ok || !strings.HasSuffix(backup,".zip") { t.Fatal(result) }
	if info, err := os.Stat(backup); err != nil || info.Size() == 0 { t.Fatal("missing safety backup",err) }
	p, _, err := readStoragePreferences()
	if err != nil { t.Fatal(err) }
	resolvedNext, _ := filepath.EvalSymlinks(next)
	resolvedRoot, _ := filepath.EvalSymlinks(root)
	if p.DataDir != resolvedNext || p.BackupRoot != resolvedRoot { t.Fatal(p) }
	dir, err := configuredBackup(p.BackupRoot,p.DataDir)
	if err != nil || filepath.Dir(dir) != resolvedRoot { t.Fatal(dir,err) }
	if _, err = os.Stat(s.archive); err != nil { t.Fatal(err) }
}

func TestStorageRejectsNonArchiveDirectory(t *testing.T) {
	t.Setenv("APPDATA", t.TempDir())
	_, h := harness(t)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir,"unrelated.txt"),[]byte("keep"),0600); err != nil { t.Fatal(err) }
	payload,_ := json.Marshal(map[string]any{"data_dir":dir,"confirm_switch":true})
	code,b := call(t,h,"PUT","/api/storage",payload,map[string]string{"Content-Type":"application/json"})
	require(t,400,code,b)
	if data,err := os.ReadFile(filepath.Join(dir,"unrelated.txt")); err != nil || string(data)!="keep" { t.Fatal("unrelated file modified") }
}
