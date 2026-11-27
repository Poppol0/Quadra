package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync/atomic"
	"time"
)

var attRoute = regexp.MustCompile(`^/api/attachments/([0-9a-f]{32})$`)
var transUploadRoute = regexp.MustCompile(`^/api/transactions/([A-Za-z0-9_-]{1,120})/attachments$`)
var transRoute = regexp.MustCompile(`^/api/transactions/([A-Za-z0-9_-]{1,120})$`)
var statementUploadRoute = regexp.MustCompile(`^/api/statements/([A-Za-z0-9_-]{1,120})/document$`)
var statementDocRoute = regexp.MustCompile(`^/api/statement-documents/([0-9a-f]{32})$`)
var allowedAssets = map[string]string{
	"/": "index.html", "/index.html": "index.html", "/app.js": "app.js", "/accounting.js": "accounting.js", "/payments.js": "payments.js", "/schedule.js": "schedule.js", "/styles.css": "styles.css", "/favicon.svg": "favicon.svg", "/manifest.webmanifest": "manifest.webmanifest", "/sw.js": "sw.js", "/notifications.js": "notifications.js", "/icon-192.png": "icon-192.png", "/icon-512.png": "icon-512.png", "/catalogo_categorie.json": "catalogo_categorie.json",
}
var mimeTypes = map[string]string{".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".png": "image/png"}

type Server struct {
	store           *Store
	host            string
	lockedDataDir   bool
	pendingDataDir  string // guarded by store.mu
	restartRequired atomic.Bool
}

func (a *Server) handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; object-src 'none'")
	if r.Host != a.host {
		respondError(w, 403, "Host non autorizzato")
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("Origin") != "http://"+a.host {
		respondError(w, 403, "Origine non autorizzata")
		return
	}
	if a.restartRequired.Load() && r.Method != "GET" && r.Method != "HEAD" {
		respondError(w, 423, "La cartella dati è stata copiata. Chiudi e riapri Quadra prima di registrare altre modifiche.")
		return
	}
	var err error
	switch r.Method {
	case "GET":
		err = a.get(w, r)
	case "PUT":
		err = a.put(w, r)
	case "POST":
		err = a.post(w, r)
	case "DELETE":
		err = a.delete(w, r)
	default:
		respondError(w, 405, "Metodo non consentito")
	}
	if err != nil {
		var he httpError
		if errors.As(err, &he) {
			respondError(w, he.code, he.msg)
		} else {
			respondError(w, 500, "Errore: "+err.Error())
		}
	}
}

type httpError struct {
	code int
	msg  string
}

func (e httpError) Error() string { return e.msg }
func bad(msg string) error        { return httpError{400, msg} }
func notFound(msg string) error   { return httpError{404, msg} }
func respond(w http.ResponseWriter, code int, val any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(val)
}
func respondError(w http.ResponseWriter, code int, msg string) {
	respond(w, code, map[string]any{"error": msg})
}
func responseBytes(w http.ResponseWriter, code int, content []byte, typ string) {
	w.Header().Set("Content-Type", typ)
	w.Header().Set("Content-Length", fmt.Sprint(len(content)))
	w.WriteHeader(code)
	_, _ = w.Write(content)
}
func limited(r *http.Request, limit int64) ([]byte, error) {
	if r.ContentLength < 1 || r.ContentLength > limit {
		return nil, httpError{413, "File vuoto o troppo grande"}
	}
	b, e := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if e != nil {
		return nil, e
	}
	if len(b) == 0 || int64(len(b)) > limit {
		return nil, httpError{413, "File troppo grande"}
	}
	return b, nil
}
func decodeHeader(s string) string {
	v, e := url.QueryUnescape(s)
	if e != nil {
		return s
	}
	return v
}
func safeName(s string) string {
	s = strings.ReplaceAll(decodeHeader(s), "\\", "/")
	s = path.Base(s)
	s = strings.Trim(s, " .\r\n\t")
	if len(s) > 180 {
		s = s[:180]
	}
	if s == "" || s == "." {
		return "Documento"
	}
	return s
}
func fileExtension(t string) string { return allowedMIMEs[t] }
func (a *Server) get(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Path
	if p == "/api/storage" {
		respond(w, 200, a.storageDetails())
		return nil
	}
	if p == "/api/state" {
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		data, e := a.store.read()
		if e != nil {
			return e
		}
		respond(w, 200, data)
		return nil
	}
	if p == "/api/backup-completo.zip" {
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		b, e := a.store.backupBytes()
		if e != nil {
			return e
		}
		w.Header().Set("Content-Disposition", "attachment; filename=Quadra_backup_completo.zip")
		responseBytes(w, 200, b, "application/zip")
		return nil
	}
	if ids := attRoute.FindStringSubmatch(p); len(ids) > 0 {
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		data, e := a.store.read()
		if e != nil {
			return e
		}
		for _, x := range arr(data["transactions"]) {
			for _, v := range arr(m(x)["attachments"]) {
				meta := m(v)
				if str(meta["id"]) == ids[1] {
					file := filepath.Join(a.store.att, ids[1]+fileExtension(str(meta["mime_type"])))
					b, er := os.ReadFile(file)
					if er != nil {
						return notFound("allegato mancante sul disco")
					}
					disp := "inline"
					if r.URL.Query().Get("download") == "1" {
						disp = "attachment"
					}
					w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, url.PathEscape(str(meta["name"]))))
					responseBytes(w, 200, b, str(meta["mime_type"]))
					return nil
				}
			}
		}
		return notFound("allegato non trovato")
	}
	if ids := statementDocRoute.FindStringSubmatch(p); len(ids) > 0 {
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		data, e := a.store.read()
		if e != nil {
			return e
		}
		for _, x := range arr(data["statements"]) {
			doc := m(m(x)["document"])
			if doc != nil && str(doc["id"]) == ids[1] {
				b, er := os.ReadFile(filepath.Join(a.store.stm, ids[1]+".pdf"))
				if er != nil {
					return notFound("PDF mancante")
				}
				disp := "inline"
				if r.URL.Query().Get("download") == "1" {
					disp = "attachment"
				}
				w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, url.PathEscape(str(doc["name"]))))
				responseBytes(w, 200, b, "application/pdf")
				return nil
			}
		}
		return notFound("documento non trovato")
	}
	if f, ok := allowedAssets[p]; ok {
		b, e := assets.ReadFile("assets/" + f)
		if e != nil {
			return notFound("risorsa non trovata")
		}
		typ := mimeTypes[path.Ext(f)]
		if typ == "" {
			typ = mime.TypeByExtension(path.Ext(f))
		}
		responseBytes(w, 200, b, typ)
		return nil
	}
	return notFound("risorsa non trovata")
}
func (a *Server) put(w http.ResponseWriter, r *http.Request) error {
	if r.URL.Path != "/api/state" {
		return notFound("indirizzo non valido")
	}
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return httpError{415, "Content-Type JSON obbligatorio"}
	}
	raw, e := limited(r, maxJSON)
	if e != nil {
		return e
	}
	var data map[string]any
	if e = json.Unmarshal(raw, &data); e != nil {
		return bad("archivio JSON non valido")
	}
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	previous, e := a.store.read()
	if e != nil {
		return e
	}
	for _, key := range []string{"accounts", "statements", "import_rules", "payment_plans", "members"} {
		if len(arr(previous[key])) > 0 {
			if _, found := data[key]; !found {
				return bad("browser non aggiornato: manca " + key)
			}
		}
	}
	if e = a.store.write(data); e != nil {
		return bad(e.Error())
	}
	respond(w, 200, map[string]any{"ok": true, "records": len(arr(data["transactions"]))})
	return nil
}
func (a *Server) post(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Path
	switch p {
	case "/api/storage/pick-folder", "/api/storage/configure-folder":
		raw, e := limited(r, 8192)
		if e != nil {
			return e
		}
		var payload struct {
			Kind string `json:"kind"`
			Path string `json:"path"`
		}
		if e = json.Unmarshal(raw, &payload); e != nil {
			return bad("richiesta cartella non valida")
		}
		if payload.Kind != "data" && payload.Kind != "backup" {
			return bad("tipo cartella non valido")
		}
		if p == "/api/storage/pick-folder" {
			current := a.store.dir
			if payload.Kind == "backup" {
				current = a.store.backup
			}
			chosen, e := pickFolder(current, payload.Kind)
			if e != nil {
				return bad(e.Error())
			}
			if chosen == "" {
				respond(w, 200, map[string]any{"cancelled": true})
				return nil
			}
			target, e := cleanChosenFolder(chosen)
			if e != nil {
				return bad(e.Error())
			}
			respond(w, 200, map[string]any{"path": target, "kind": payload.Kind})
			return nil
		}
		result, e := a.configureFolder(payload.Kind, payload.Path)
		if e != nil {
			return e
		}
		respond(w, 200, result)
		return nil
	case "/api/backup/save-to-folder":
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		result, e := a.store.saveCompleteBackup("quadra-backup-completo-")
		if e != nil {
			return e
		}
		respond(w, 200, result)
		return nil
	case "/api/archives/inspect", "/api/archives/restore":
		raw, e := limited(r, maxBackup)
		if e != nil {
			return e
		}
		seed, e := assets.ReadFile("assets/templates/archivio_iniziale.json")
		if e != nil {
			return e
		}
		var tmp map[string]any
		_ = json.Unmarshal(seed, &tmp)
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		packageData, e := readRestore(raw, safeName(r.Header.Get("X-Quadra-Filename")), arr(tmp["categories"]))
		if e != nil {
			return bad(e.Error())
		}
		if p == "/api/archives/inspect" {
			respond(w, 200, packageData.summary)
			return nil
		}
		if r.Header.Get("X-Quadra-Action") != "SOSTITUISCI" {
			return bad("conferma esplicita obbligatoria")
		}
		result, e := a.store.restore(packageData)
		if e != nil {
			return e
		}
		respond(w, 200, result)
		return nil
	case "/api/parse-import":
		raw, e := limited(r, maxImport)
		if e != nil {
			return e
		}
		data, e := parseUpload(raw, safeName(r.Header.Get("X-Quadra-Filename")), decodeHeader(r.Header.Get("X-Quadra-Sheet")))
		if e != nil {
			return bad("Importazione: " + e.Error())
		}
		respond(w, 200, data)
		return nil
	case "/api/pre-import-backup":
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		name, e := a.store.preimportBackup()
		if e != nil {
			return e
		}
		respond(w, 200, map[string]any{"ok": true, "backup": name})
		return nil
	}
	if ids := statementUploadRoute.FindStringSubmatch(p); len(ids) > 0 {
		raw, e := limited(r, maxDocument)
		if e != nil {
			return e
		}
		if fileMIME(raw) != "application/pdf" {
			return bad("sono consentiti solo PDF")
		}
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		data, e := a.store.read()
		if e != nil {
			return e
		}
		for _, x := range arr(data["statements"]) {
			stm := m(x)
			if str(stm["id"]) != ids[1] {
				continue
			}
			old := m(stm["document"])
			uid := randomID()
			meta := map[string]any{"id": uid, "name": safeName(r.Header.Get("X-Quadra-Filename")), "mime_type": "application/pdf", "size": len(raw)}
			full := filepath.Join(a.store.stm, uid+".pdf")
			if e = os.WriteFile(full, raw, 0600); e != nil {
				return e
			}
			stm["document"] = meta
			if e = a.store.write(data); e != nil {
				_ = os.Remove(full)
				return bad(e.Error())
			}
			if old != nil {
				_ = os.Remove(filepath.Join(a.store.stm, str(old["id"])+".pdf"))
			}
			respond(w, 201, map[string]any{"ok": true, "document": meta})
			return nil
		}
		return notFound("estratto non trovato")
	}
	if ids := transUploadRoute.FindStringSubmatch(p); len(ids) > 0 {
		raw, e := limited(r, maxDocument)
		if e != nil {
			return e
		}
		mimeDetected := fileMIME(raw)
		if mimeDetected == "" {
			return bad("tipo file non supportato")
		}
		if contentType := strings.Split(r.Header.Get("Content-Type"), ";")[0]; contentType != "" && contentType != "application/octet-stream" && contentType != mimeDetected {
			return bad("formato e contenuto del file non coincidono")
		}
		tag := decodeHeader(r.Header.Get("X-Quadra-Tag"))
		if tag == "" {
			tag = "scontrino"
		}
		if !allowedTags[tag] {
			return bad("etichetta non valida")
		}
		a.store.mu.Lock()
		defer a.store.mu.Unlock()
		data, e := a.store.read()
		if e != nil {
			return e
		}
		for _, x := range arr(data["transactions"]) {
			t := m(x)
			if str(t["id"]) != ids[1] {
				continue
			}
			at := arr(t["attachments"])
			if len(at) >= maxAttachments {
				return bad("massimo 20 allegati per movimento")
			}
			id := randomID()
			meta := map[string]any{"id": id, "name": safeName(r.Header.Get("X-Quadra-Filename")), "mime_type": mimeDetected, "size": len(raw), "tag": tag, "uploaded_at": time.Now().UTC().Format(time.RFC3339)}
			full := filepath.Join(a.store.att, id+fileExtension(mimeDetected))
			if e = os.WriteFile(full, raw, 0600); e != nil {
				return e
			}
			at = append(at, meta)
			t["attachments"] = at
			if e = a.store.write(data); e != nil {
				_ = os.Remove(full)
				return bad(e.Error())
			}
			respond(w, 201, map[string]any{"ok": true, "attachment": meta, "attachments": at})
			return nil
		}
		return notFound("movimento non trovato")
	}
	return notFound("indirizzo non valido")
}
func (a *Server) delete(w http.ResponseWriter, r *http.Request) error {
	p := r.URL.Path
	a.store.mu.Lock()
	defer a.store.mu.Unlock()
	data, e := a.store.read()
	if e != nil {
		return e
	}
	if ids := attRoute.FindStringSubmatch(p); len(ids) > 0 {
		for _, x := range arr(data["transactions"]) {
			t := m(x)
			existing := arr(t["attachments"])
			newatt := []any{}
			var meta map[string]any
			for _, att := range existing {
				if str(m(att)["id"]) == ids[1] {
					meta = m(att)
				} else {
					newatt = append(newatt, att)
				}
			}
			if meta == nil {
				continue
			}
			t["attachments"] = newatt
			if e = a.store.write(data); e != nil {
				return bad(e.Error())
			}
			_ = os.Remove(filepath.Join(a.store.att, ids[1]+fileExtension(str(meta["mime_type"]))))
			respond(w, 200, map[string]any{"ok": true, "transaction_id": str(t["id"]), "attachments": newatt})
			return nil
		}
		return notFound("allegato non trovato")
	}
	if ids := statementUploadRoute.FindStringSubmatch(p); len(ids) > 0 {
		for _, x := range arr(data["statements"]) {
			stmt := m(x)
			if str(stmt["id"]) != ids[1] {
				continue
			}
			old := m(stmt["document"])
			delete(stmt, "document")
			if e = a.store.write(data); e != nil {
				return bad(e.Error())
			}
			if old != nil {
				_ = os.Remove(filepath.Join(a.store.stm, str(old["id"])+".pdf"))
			}
			respond(w, 200, map[string]any{"ok": true})
			return nil
		}
		return notFound("estratto non trovato")
	}
	if ids := transRoute.FindStringSubmatch(p); len(ids) > 0 {
		remaining := []any{}
		var removed map[string]any
		for _, x := range arr(data["transactions"]) {
			if str(m(x)["id"]) == ids[1] {
				removed = m(x)
			} else {
				remaining = append(remaining, x)
			}
		}
		if removed == nil {
			return notFound("movimento non trovato")
		}
		data["transactions"] = remaining
		if e = a.store.write(data); e != nil {
			return bad(e.Error())
		}
		for _, x := range arr(removed["attachments"]) {
			meta := m(x)
			_ = os.Remove(filepath.Join(a.store.att, str(meta["id"])+fileExtension(str(meta["mime_type"]))))
		}
		respond(w, 200, map[string]any{"ok": true})
		return nil
	}
	return notFound("indirizzo non valido")
}
