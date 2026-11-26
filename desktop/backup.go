package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxBackup = 200 * 1024 * 1024
const maxUnpacked = 420 * 1024 * 1024

func randomID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return fmt.Sprintf("%x", b)
}
func metadataDocuments(data map[string]any) (map[string]map[string]any, error) {
	out := map[string]map[string]any{}
	for _, x := range arr(data["transactions"]) {
		for _, y := range arr(m(x)["attachments"]) {
			a := m(y)
			rel := "allegati/" + str(a["id"]) + allowedMIMEs[str(a["mime_type"])]
			if _, ok := out[rel]; ok {
				return nil, errors.New("allegato duplicato")
			}
			out[rel] = a
		}
	}
	for _, x := range arr(data["statements"]) {
		if doc := m(m(x)["document"]); doc != nil {
			rel := "estratti/" + str(doc["id"]) + ".pdf"
			if _, ok := out[rel]; ok {
				return nil, errors.New("PDF duplicato")
			}
			out[rel] = doc
		}
	}
	return out, nil
}
func (s *Store) backupBytes() ([]byte, error) {
	data, err := s.read()
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(s.archive)
	if err != nil {
		return nil, err
	}
	expected, err := metadataDocuments(data)
	if err != nil {
		return nil, err
	}
	contents := map[string][]byte{"archivio.json": raw}
	for rel := range expected {
		folder := s.att
		if strings.HasPrefix(rel, "estratti/") {
			folder = s.stm
		}
		b, err := os.ReadFile(filepath.Join(folder, path.Base(rel)))
		if err != nil {
			return nil, fmt.Errorf("backup incompleto: documento %s mancante", rel)
		}
		contents[rel] = b
	}
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	checks := map[string]string{}
	names := []string{}
	for k := range contents {
		names = append(names, k)
	}
	sort.Strings(names)
	for _, name := range names {
		b := contents[name]
		f, e := w.Create(name)
		if e != nil {
			return nil, e
		}
		if _, e = f.Write(b); e != nil {
			return nil, e
		}
		checks[name] = sha(b)
	}
	manifest, _ := json.MarshalIndent(map[string]any{"format": "quadra-complete-backup-v1", "created_at": time.Now().UTC().Format(time.RFC3339), "sha256": checks}, "", "  ")
	f, e := w.Create("manifest.json")
	if e != nil {
		return nil, e
	}
	if _, e = f.Write(manifest); e != nil {
		return nil, e
	}
	f, e = w.Create("LEGGIMI_RIPRISTINO.txt")
	if e != nil {
		return nil, e
	}
	if _, e = f.Write([]byte("Quadra - backup completo offline\nPer ripristinare: Impostazioni > Ripristina archivio completo.\n")); e != nil {
		return nil, e
	}
	if e = w.Close(); e != nil {
		return nil, e
	}
	return buf.Bytes(), nil
}
func (s *Store) preimportBackup() (string, error) {
	b, err := s.backupBytes()
	if err != nil {
		return "", err
	}
	name := "quadra-prima-importazione-" + time.Now().Format("20060102-150405.000000") + ".zip"
	if err = os.WriteFile(filepath.Join(s.backup, name), b, 0600); err != nil {
		return "", err
	}
	entries, _ := os.ReadDir(s.backup)
	names := []string{}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "quadra-prima-importazione-") && strings.HasSuffix(e.Name(), ".zip") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) > 15 {
		for _, n := range names[:len(names)-15] {
			_ = os.Remove(filepath.Join(s.backup, n))
		}
	}
	return name, nil
}

type RestorePackage struct {
	data      map[string]any
	documents map[string][]byte
	summary   map[string]any
}

func normalize(data map[string]any, fallback []any) map[string]any {
	for _, key := range []string{"transactions", "recurring", "payment_plans", "budgets", "goals", "accounts", "statements", "import_rules"} {
		if _, ok := data[key]; !ok {
			data[key] = []any{}
		}
	}
	if _, ok := data["categories"]; !ok {
		data["categories"] = fallback
	}
	if _, ok := data["members"]; !ok {
		data["members"] = []any{}
	}
	current := map[string]bool{}
	for _, v := range arr(data["members"]) {
		current[strings.ToLower(memberName(v))] = true
	}
	for _, key := range []string{"transactions", "recurring", "payment_plans", "budgets", "accounts"} {
		for _, x := range arr(data[key]) {
			name := str(m(x)["owner"])
			if len(strings.TrimSpace(name)) > 1 && name != "Famiglia" && name != "Non attribuito" && !current[strings.ToLower(name)] {
				data["members"] = append(arr(data["members"]), map[string]any{"id": "member-" + randomID(), "name": name, "active": true})
				current[strings.ToLower(name)] = true
			}
		}
	}
	data["accounts_initialized"] = true
	data["format"] = "quadra-family-v1"
	data["version"] = float64(5)
	return data
}
func backupSummary(data map[string]any, kind, oldformat string, filecount int) map[string]any {
	out := map[string]any{"kind": kind, "original_format": oldformat, "files": filecount, "warning": "Il ripristino SOSTITUISCE il contenuto dell'archivio attivo, dopo un backup completo."}
	for _, name := range []string{"transactions", "members", "accounts", "recurring", "payment_plans", "budgets", "categories", "statements"} {
		out[name] = len(arr(data[name]))
	}
	return out
}
func readRestore(raw []byte, filename string, fallback []any) (*RestorePackage, error) {
	if len(raw) == 0 || len(raw) > maxBackup {
		return nil, errors.New("backup vuoto o oltre 200 MB")
	}
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".json") {
		if len(raw) > maxDocument {
			return nil, errors.New("JSON troppo grande")
		}
		var data map[string]any
		if err := json.Unmarshal(raw, &data); err != nil {
			return nil, errors.New("JSON illeggibile")
		}
		old := str(data["format"])
		if old != "quadra-family-v1" && old != "nido-family-v1" {
			return nil, errors.New("formato JSON non compatibile")
		}
		data = normalize(data, fallback)
		if err := validate(data); err != nil {
			return nil, err
		}
		docs, _ := metadataDocuments(data)
		if len(docs) > 0 {
			return nil, errors.New("il JSON contiene documenti: usa il backup completo ZIP")
		}
		return &RestorePackage{data: data, documents: map[string][]byte{}, summary: backupSummary(data, "JSON", old, 0)}, nil
	}
	if !strings.HasSuffix(lower, ".zip") {
		return nil, errors.New("usa un backup ZIP o JSON")
	}
	r, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, errors.New("ZIP illeggibile")
	}
	if len(r.File) > 10000 {
		return nil, errors.New("troppi file nel backup")
	}
	candidates := []string{}
	files := map[string]*zip.File{}
	var expanded int64
	for _, z := range r.File {
		name := z.Name
		if strings.HasPrefix(name, "/") || strings.HasPrefix(name, "./") || strings.Contains(name, "\\") || strings.Contains(name, "..") || strings.Contains(name, ":") || path.Clean(name) != strings.TrimSuffix(name, "/") && !z.FileInfo().IsDir() {
			return nil, errors.New("nome non sicuro nel backup")
		}
		if z.Mode()&os.ModeSymlink != 0 {
			return nil, errors.New("collegamenti simbolici non ammessi")
		}
		expanded += int64(z.UncompressedSize64)
		if expanded > maxUnpacked {
			return nil, errors.New("backup decomprimibile troppo grande")
		}
		if z.FileInfo().IsDir() {
			continue
		}
		if _, ok := files[name]; ok {
			return nil, errors.New("file duplicato nello ZIP")
		}
		files[name] = z
		if name == "archivio.json" || (strings.Count(name, "/") == 1 && strings.HasSuffix(name, "/archivio.json")) {
			candidates = append(candidates, name)
		}
	}
	if len(candidates) != 1 {
		return nil, errors.New("lo ZIP deve contenere un solo archivio.json")
	}
	archiveName := candidates[0]
	prefix := strings.TrimSuffix(archiveName, "archivio.json")
	get := func(f *zip.File, limit int64) ([]byte, error) {
		if f == nil {
			return nil, errors.New("file obbligatorio mancante")
		}
		if int64(f.UncompressedSize64) > limit {
			return nil, errors.New("file troppo grande nel backup")
		}
		rc, e := f.Open()
		if e != nil {
			return nil, e
		}
		defer rc.Close()
		return io.ReadAll(io.LimitReader(rc, limit+1))
	}
	jsonRaw, err := get(files[archiveName], maxDocument)
	if err != nil || len(jsonRaw) > maxDocument {
		return nil, errors.New("archivio ZIP non valido")
	}
	var data map[string]any
	if err = json.Unmarshal(jsonRaw, &data); err != nil {
		return nil, err
	}
	old := str(data["format"])
	if old != "quadra-family-v1" && old != "nido-family-v1" {
		return nil, errors.New("formato archivio sconosciuto")
	}
	data = normalize(data, fallback)
	if err = validate(data); err != nil {
		return nil, err
	}
	expected, err := metadataDocuments(data)
	if err != nil {
		return nil, err
	}
	documents := map[string][]byte{}
	for rel, meta := range expected {
		f := files[prefix+rel]
		blob, er := get(f, maxDocument)
		if er != nil {
			return nil, fmt.Errorf("allegato mancante o corrotto: %s: %w", rel, er)
		}
		if size, ok := nint(meta["size"]); ok && size != int64(len(blob)) {
			return nil, errors.New("dimensione documento incoerente")
		}
		ext := path.Ext(rel)
		if ext != allowedMIMEs[fileMIME(blob)] {
			return nil, errors.New("documento danneggiato o formato non valido")
		}
		documents[rel] = blob
	}
	if mf := files[prefix+"manifest.json"]; mf != nil {
		b, er := get(mf, maxDocument)
		if er != nil {
			return nil, er
		}
		var manifest struct {
			Sha map[string]string `json:"sha256"`
		}
		if er = json.Unmarshal(b, &manifest); er != nil {
			return nil, er
		}
		if manifest.Sha["archivio.json"] != sha(jsonRaw) {
			return nil, errors.New("checksum archivio non valido")
		}
		for rel, blob := range documents {
			if manifest.Sha[rel] != sha(blob) {
				return nil, fmt.Errorf("checksum non valido: %s", rel)
			}
		}
	}
	return &RestorePackage{data: data, documents: documents, summary: backupSummary(data, "ZIP", old, len(documents))}, nil
}
func (s *Store) restore(p *RestorePackage) (map[string]any, error) {
	if err := validate(p.data); err != nil {
		return nil, err
	}
	stage, err := os.MkdirTemp(s.dir, ".quadra-stage-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(stage)
	raw, err := json.MarshalIndent(p.data, "", "  ")
	if err != nil {
		return nil, err
	}
	if err = os.WriteFile(filepath.Join(stage, "archivio.json"), append(raw, '\n'), 0600); err != nil {
		return nil, err
	}
	for _, rel := range []string{"allegati", "estratti"} {
		if err = os.Mkdir(filepath.Join(stage, rel), 0700); err != nil {
			return nil, err
		}
	}
	for rel, blob := range p.documents {
		if err = os.WriteFile(filepath.Join(stage, filepath.FromSlash(rel)), blob, 0600); err != nil {
			return nil, err
		}
	}
	if _, err = s.preimportBackup(); err != nil {
		return nil, err
	}
	rollback := filepath.Join(s.dir, ".quadra-rollback-"+randomID())
	if err = os.Mkdir(rollback, 0700); err != nil {
		return nil, err
	}
	moved := []string{}
	placed := []string{}
	names := []string{"archivio.json", "allegati", "estratti"}
	for _, name := range names {
		if _, err = os.Stat(filepath.Join(s.dir, name)); err == nil {
			if err = os.Rename(filepath.Join(s.dir, name), filepath.Join(rollback, name)); err != nil {
				break
			}
			moved = append(moved, name)
		}
		if err = os.Rename(filepath.Join(stage, name), filepath.Join(s.dir, name)); err != nil {
			break
		}
		placed = append(placed, name)
	}
	if err != nil {
		for i := len(placed) - 1; i >= 0; i-- {
			_ = os.RemoveAll(filepath.Join(s.dir, placed[i]))
		}
		for _, name := range moved {
			_ = os.Rename(filepath.Join(rollback, name), filepath.Join(s.dir, name))
		}
		return nil, err
	}
	_ = os.RemoveAll(rollback)
	result := map[string]any{}
	for k, v := range p.summary {
		result[k] = v
	}
	result["restored"] = true
	return result, nil
}
