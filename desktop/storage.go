package main

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxJSON = 12 * 1024 * 1024
const maxDocument = 12 * 1024 * 1024
const maxAttachments = 20

var rxID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,120}$`)
var rxAttachmentID = regexp.MustCompile(`^[0-9a-f]{32}$`)
var rxDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
var allowedMIMEs = map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf"}
var allowedTags = map[string]bool{"scontrino": true, "ricevuta": true, "garanzia": true, "documento": true, "altro": true}

type Store struct {
	mu      sync.Mutex
	dir     string
	archive string
	backup  string
	att     string
	stm     string
}

// storageConfig is intentionally outside the installation directory. Existing
// configurations containing only data_dir remain compatible.
type storageConfig struct {
	DataDir   string `json:"data_dir,omitempty"`
	BackupDir string `json:"backup_dir,omitempty"`
}

func storageConfigFile() string { return filepath.Join(userConfigDir(), "config.json") }
func readStorageConfig() (storageConfig, error) {
	var cfg storageConfig
	b, err := os.ReadFile(storageConfigFile())
	if errors.Is(err, os.ErrNotExist) {
		return cfg, nil
	}
	if err != nil {
		return cfg, err
	}
	if err = json.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("configurazione dei percorsi non valida: %w", err)
	}
	return cfg, nil
}
func writeStorageConfig(cfg storageConfig) error {
	folder := userConfigDir()
	if err := os.MkdirAll(folder, 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(folder, ".quadra-config-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if err = tmp.Chmod(0600); err != nil {
		tmp.Close()
		return err
	}
	if _, err = tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), storageConfigFile())
}
func appDataDir() string {
	if env := strings.TrimSpace(os.Getenv("QUADRA_DATA_DIR")); env != "" {
		return os.ExpandEnv(env)
	}
	if cfg, err := readStorageConfig(); err == nil && cfg.DataDir != "" {
		return os.ExpandEnv(cfg.DataDir)
	}
	home, _ := os.UserHomeDir()
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		return filepath.Join(local, "Quadra")
	}
	return filepath.Join(home, ".local", "share", "Quadra")
}
func appBackupDir(dataDir string) string {
	if env := strings.TrimSpace(os.Getenv("QUADRA_BACKUP_DIR")); env != "" {
		return os.ExpandEnv(env)
	}
	if cfg, err := readStorageConfig(); err == nil && cfg.BackupDir != "" {
		return os.ExpandEnv(cfg.BackupDir)
	}
	return filepath.Join(dataDir, "backup")
}
func userConfigDir() string {
	if s := os.Getenv("APPDATA"); s != "" {
		return filepath.Join(s, "Quadra")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "Quadra")
}
func makeStore(dir string) (*Store, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	app, _ := os.Executable()
	appdir := filepath.Dir(app)
	if abs == appdir || strings.HasPrefix(strings.ToLower(abs)+string(os.PathSeparator), strings.ToLower(appdir)+string(os.PathSeparator)) {
		return nil, errors.New("la cartella dati non puo stare nella cartella del programma")
	}
	s := &Store{dir: abs, archive: filepath.Join(abs, "archivio.json"), backup: appBackupDir(abs), att: filepath.Join(abs, "allegati"), stm: filepath.Join(abs, "estratti")}
	for _, folder := range []string{abs, s.backup, s.att, s.stm} {
		if err = os.MkdirAll(folder, 0700); err != nil {
			return nil, err
		}
	}
	if _, err = os.Stat(s.archive); os.IsNotExist(err) {
		raw, er := assets.ReadFile("assets/templates/archivio_iniziale.json")
		if er != nil {
			return nil, er
		}
		var data map[string]interface{}
		if er = json.Unmarshal(raw, &data); er != nil {
			return nil, er
		}
		data["created_at"] = time.Now().Format("2006-01-02")
		raw, er = json.MarshalIndent(data, "", "  ")
		if er != nil {
			return nil, er
		}
		f, er := os.OpenFile(s.archive, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if er != nil {
			return nil, er
		}
		_, er = f.Write(append(raw, '\n'))
		if er == nil {
			er = f.Sync()
		}
		_ = f.Close()
		if er != nil {
			return nil, er
		}
	} else if err != nil {
		return nil, err
	}
	if _, err = s.read(); err != nil {
		return nil, fmt.Errorf("archivio non valido: %w", err)
	}
	return s, nil
}
func m(v any) map[string]any { r, _ := v.(map[string]any); return r }
func arr(v any) []any        { r, _ := v.([]any); return r }
func str(v any) string       { x, _ := v.(string); return x }
func nint(v any) (int64, bool) {
	switch n := v.(type) {
	case int:
		return int64(n), true
	case int64:
		return n, true
	case float64:
		if n == float64(int64(n)) {
			return int64(n), true
		}
	}
	return 0, false
}
func dateOK(s string) bool {
	if !rxDate.MatchString(s) {
		return false
	}
	t, e := time.Parse("2006-01-02", s)
	return e == nil && t.Format("2006-01-02") == s
}
func memberName(v any) string { return str(m(v)["name"]) }
func validate(data map[string]any) error {
	if data == nil || (str(data["format"]) != "quadra-family-v1" && str(data["format"]) != "nido-family-v1") {
		return errors.New("formato archivio incompatibile")
	}
	// Required record collections and unique record IDs.
	for _, field := range []struct {
		name  string
		limit int
	}{{"transactions", 20000}, {"recurring", 1000}, {"budgets", 1000}, {"goals", 1000}} {
		vals, ok := data[field.name].([]any)
		if !ok || len(vals) > field.limit {
			return fmt.Errorf("sezione %s non valida", field.name)
		}
		seen := map[string]bool{}
		for _, item := range vals {
			r := m(item)
			id := str(r["id"])
			if id == "" || seen[id] {
				return fmt.Errorf("identificativo duplicato o mancante in %s", field.name)
			}
			seen[id] = true
		}
	}
	members := arr(data["members"])
	if len(members) > 30 {
		return errors.New("troppi componenti")
	}
	names := map[string]bool{"Famiglia": true}
	mids := map[string]bool{}
	for _, v := range members {
		a := m(v)
		id := str(a["id"])
		name := str(a["name"])
		if !rxID.MatchString(id) || mids[id] || len(strings.TrimSpace(name)) < 2 || len(name) > 70 || strings.TrimSpace(name) != name || names[name] {
			return errors.New("componente familiare non valido")
		}
		if active, ok := a["active"]; ok {
			if _, ok = active.(bool); !ok {
				return errors.New("stato membro non valido")
			}
		}
		mids[id] = true
		names[name] = true
	}
	cats := arr(data["categories"])
	if len(cats) > 500 {
		return errors.New("troppe categorie")
	}
	cids := map[string]bool{}
	for _, v := range cats {
		c := m(v)
		id := str(c["id"])
		if id == "" || cids[id] || str(c["name"]) == "" || str(c["group"]) == "" {
			return errors.New("categoria non valida")
		}
		cids[id] = true
	}
	accts := arr(data["accounts"])
	if len(accts) > 40 {
		return errors.New("troppi conti")
	}
	aids := map[string]bool{}
	for _, v := range accts {
		a := m(v)
		id := str(a["id"])
		k := str(a["account_kind"])
		typ := str(a["type"])
		if !rxID.MatchString(id) || aids[id] || !names[str(a["owner"])] || !strings.Contains("|bank|cash|", "|"+typ+"|") || str(a["label"]) == "" {
			return errors.New("conto non valido")
		}
		if k != "" && k != "personal" && k != "mortgage" && k != "cash" && k != "joint" {
			return errors.New("tipologia conto non valida")
		}
		if k != "" && (k == "cash") != (typ == "cash") {
			return errors.New("tipo conto non coerente")
		}
		if opening := str(a["opening_on"]); opening != "" {
			if !dateOK(opening) {
				return errors.New("data apertura conto non valida")
			}
			if _, ok := nint(a["opening_cents"]); !ok {
				return errors.New("saldo iniziale non valido")
			}
		}
		aids[id] = true
	}
	seenFiles := map[string]bool{}
	for _, item := range arr(data["transactions"]) {
		t := m(item)
		id := str(t["id"])
		if id == "" || !dateOK(str(t["occurred_on"])) {
			return errors.New("data movimento non valida")
		}
		amount, ok := nint(t["amount_cents"])
		if !ok || amount < 1 || amount > 100000000000 {
			return errors.New("importo movimento non valido")
		}
		if !strings.Contains("|income|expense|benefit|transfer|withdrawal|investment|", "|"+str(t["kind"])+"|") {
			return errors.New("tipo movimento non valido")
		}
		if owner := str(t["owner"]); owner != "" && !names[owner] && owner != "Non attribuito" {
			return errors.New("intestatario movimento inesistente")
		}
		for _, f := range []string{"account_id", "counterparty_account_id"} {
			if a := str(t[f]); a != "" && !aids[a] {
				return errors.New("conto del movimento inesistente")
			}
		}
		if src, dst := str(t["account_id"]), str(t["counterparty_account_id"]); src != "" && src == dst {
			return errors.New("giroconto verso lo stesso conto")
		}
		if txt := str(t["details"]); len(txt) > 4000 {
			return errors.New("descrizione movimento troppo lunga")
		}
		att := arr(t["attachments"])
		if len(att) > maxAttachments {
			return errors.New("troppi allegati")
		}
		for _, v := range att {
			a := m(v)
			fid := str(a["id"])
			size, ok := nint(a["size"])
			if !rxAttachmentID.MatchString(fid) || seenFiles[fid] || !ok || size < 1 || size > maxDocument || allowedMIMEs[str(a["mime_type"])] == "" || !allowedTags[str(a["tag"])] || str(a["name"]) == "" {
				return errors.New("allegato non valido")
			}
			seenFiles[fid] = true
		}
	}
	for _, v := range arr(data["statements"]) {
		a := m(v)
		if !rxID.MatchString(str(a["id"])) || !aids[str(a["account_id"])] || !dateOK(str(a["period_start"])) || !dateOK(str(a["period_end"])) {
			return errors.New("estratto conto non valido")
		}
		if _, ok := nint(a["opening_cents"]); !ok {
			return errors.New("saldo estratto non valido")
		}
		if _, ok := nint(a["closing_cents"]); !ok {
			return errors.New("saldo estratto non valido")
		}
		if doc := m(a["document"]); doc != nil {
			id := str(doc["id"])
			if !rxAttachmentID.MatchString(id) || seenFiles[id] || str(doc["mime_type"]) != "application/pdf" {
				return errors.New("documento estratto non valido")
			}
			seenFiles[id] = true
		}
	}
	for _, v := range arr(data["recurring"]) {
		a := m(v)
		if _, ok := nint(a["amount_cents"]); !ok {
			return errors.New("importo ricorrenza non valido")
		}
		if !strings.Contains("|monthly|yearly|", "|"+str(a["frequency"])+"|") {
			return errors.New("frequenza ricorrenza non valida")
		}
	}
	plans := arr(data["payment_plans"])
	if len(plans) > 500 {
		return errors.New("troppi piani a rate")
	}
	for _, v := range plans {
		p := m(v)
		id := str(p["id"])
		n, ok := nint(p["installment_count"])
		paid, pok := nint(p["paid_before"])
		amt, aok := nint(p["amount_cents"])
		if !rxID.MatchString(id) || !ok || !pok || !aok || n < 2 || n > 240 || paid < 0 || paid > n || amt < 1 || !dateOK(str(p["first_due_on"])) || !names[str(p["owner"])] {
			return errors.New("piano a rate non valido")
		}
		if aid := str(p["account_id"]); aid != "" && !aids[aid] {
			return errors.New("conto rata non valido")
		}
	}
	return nil
}
func (s *Store) read() (map[string]any, error) {
	raw, e := os.ReadFile(s.archive)
	if e != nil {
		return nil, e
	}
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, err
	}
	return v, validate(v)
}
func (s *Store) atomicWrite(raw []byte) error {
	f, err := os.CreateTemp(s.dir, ".quadra-write-*.json")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err != nil {
		_ = f.Close()
		return err
	}
	if _, err = f.Write(raw); err == nil {
		err = f.Sync()
	}
	_ = f.Close()
	if err != nil {
		return err
	}
	return os.Rename(name, s.archive)
}
func (s *Store) backupPrevious() error {
	entries, err := os.ReadDir(s.backup)
	if err != nil {
		return err
	}
	latest := time.Time{}
	names := []string{}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "quadra-") && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
			if info, er := e.Info(); er == nil && info.ModTime().After(latest) {
				latest = info.ModTime()
			}
		}
	}
	if time.Since(latest) < time.Hour {
		return nil
	}
	stamp := time.Now().Format("20060102-150405.000000")
	src, err := os.Open(s.archive)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(filepath.Join(s.backup, "quadra-"+stamp+".json"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(dst, src)
	if err == nil {
		err = dst.Sync()
	}
	_ = dst.Close()
	if err != nil {
		return err
	}
	names = append(names, "quadra-"+stamp+".json")
	sort.Strings(names)
	if len(names) > 40 {
		for _, n := range names[:len(names)-40] {
			_ = os.Remove(filepath.Join(s.backup, n))
		}
	}
	return nil
}
func (s *Store) write(v map[string]any) error {
	if err := validate(v); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if len(raw) > maxJSON {
		return errors.New("archivio superiore a 12 MB")
	}
	if err = s.backupPrevious(); err != nil {
		return err
	}
	return s.atomicWrite(raw)
}
func sha(b []byte) string { sum := sha256.Sum256(b); return fmt.Sprintf("%x", sum[:]) }
func fileMIME(b []byte) string {
	if len(b) > 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff {
		return "image/jpeg"
	}
	if len(b) >= 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n" {
		return "image/png"
	}
	if len(b) >= 12 && string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
		return "image/webp"
	}
	if len(b) >= 5 && string(b[:5]) == "%PDF-" {
		return "application/pdf"
	}
	return ""
}
