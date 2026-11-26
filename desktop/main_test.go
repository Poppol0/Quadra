package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func harness(t *testing.T) (*Store, *httptest.Server) {
	t.Helper()
	s, e := makeStore(filepath.Join(t.TempDir(), "QuadraData"))
	if e != nil {
		t.Fatal(e)
	}
	b := &Server{store: s}
	http := httptest.NewServer(http.HandlerFunc(b.handler))
	b.host = strings.TrimPrefix(http.URL, "http://")
	t.Cleanup(http.Close)
	return s, http
}
func call(t *testing.T, server *httptest.Server, method, path string, body []byte, headers map[string]string) (int, []byte) {
	t.Helper()
	req, e := http.NewRequest(method, server.URL+path, bytes.NewReader(body))
	if e != nil {
		t.Fatal(e)
	}
	if method != "GET" {
		req.Header.Set("Origin", server.URL)
	}
	for key, val := range headers {
		req.Header.Set(key, val)
	}
	res, e := server.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b
}
func require(t *testing.T, expected, got int, payload []byte) {
	t.Helper()
	if expected != got {
		t.Fatalf("status expected=%d got=%d body=%s", expected, got, payload)
	}
}
func TestDesktopStateAndBackup(t *testing.T) {
	s, h := harness(t)
	code, b := call(t, h, "GET", "/", nil, nil)
	require(t, 200, code, b)
	if !bytes.Contains(b, []byte("Quadra")) {
		t.Fatal("missing app")
	}
	code, b = call(t, h, "GET", "/api/state", nil, nil)
	require(t, 200, code, b)
	var data map[string]any
	if e := json.Unmarshal(b, &data); e != nil {
		t.Fatal(e)
	}
	for _, key := range []string{"members", "transactions", "accounts", "recurring"} {
		if len(arr(data[key])) != 0 {
			t.Fatalf("not clean: %s", key)
		}
	}
	data["members"] = []any{map[string]any{"id": "member-1", "name": "Persona Uno", "active": true}}
	data["accounts"] = []any{map[string]any{"id": "cont-1", "label": "Conto personale", "type": "bank", "account_kind": "personal", "owner": "Persona Uno", "active": true, "opening_on": "2026-11-01", "opening_cents": float64(50000)}}
	data["transactions"] = []any{map[string]any{"id": "t1", "occurred_on": "2026-11-24", "kind": "expense", "amount_cents": float64(1299), "merchant": "Negozio", "owner": "Persona Uno", "account_id": "cont-1", "attachments": []any{}}}
	raw, _ := json.Marshal(data)
	code, b = call(t, h, "PUT", "/api/state", raw, map[string]string{"Content-Type": "application/json"})
	require(t, 200, code, b)
	code, b = call(t, h, "GET", "/api/state", nil, nil)
	require(t, 200, code, b)
	if !bytes.Contains(b, []byte("Persona Uno")) {
		t.Fatal("write missing")
	}
	sampleJPG := append([]byte{0xff, 0xd8, 0xff, 0xe0}, bytes.Repeat([]byte("quadra-test"), 24)...)
	code, b = call(t, h, "POST", "/api/transactions/t1/attachments", sampleJPG, map[string]string{"Content-Type": "image/jpeg", "X-Quadra-Filename": "scontrino.jpg", "X-Quadra-Tag": "scontrino"})
	require(t, 201, code, b)
	var added map[string]any
	if e := json.Unmarshal(b, &added); e != nil {
		t.Fatal(e)
	}
	meta := m(added["attachment"])
	aid := str(meta["id"])
	if len(aid) != 32 {
		t.Fatal("attachment id")
	}
	code, b = call(t, h, "GET", "/api/attachments/"+aid, nil, nil)
	require(t, 200, code, b)
	if !bytes.Equal(b, sampleJPG) {
		t.Fatal("attachment bytes changed")
	}
	code, archive := call(t, h, "GET", "/api/backup-completo.zip", nil, nil)
	require(t, 200, code, archive)
	pack, e := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if e != nil {
		t.Fatal(e)
	}
	if len(pack.File) < 3 {
		t.Fatal("zip incomplete")
	}
	second, hh := harness(t)
	code, b = call(t, hh, "POST", "/api/archives/inspect", archive, map[string]string{"X-Quadra-Filename": "backup.zip", "Content-Type": "application/zip"})
	require(t, 200, code, b)
	if !bytes.Contains(b, []byte(`"files":1`)) {
		t.Fatalf("missing file summary: %s", b)
	}
	code, b = call(t, hh, "POST", "/api/archives/restore", archive, map[string]string{"X-Quadra-Filename": "backup.zip", "X-Quadra-Action": "SOSTITUISCI"})
	require(t, 200, code, b)
	if _, e = os.Stat(filepath.Join(second.att, aid+".jpg")); e != nil {
		t.Fatalf("file missing after restore %v", e)
	}
	code, b = call(t, hh, "GET", "/api/state", nil, nil)
	require(t, 200, code, b)
	if !bytes.Contains(b, []byte("Persona Uno")) {
		t.Fatal("restore state missing")
	}
	code, b = call(t, hh, "DELETE", "/api/attachments/"+aid, nil, nil)
	require(t, 200, code, b)
	code, b = call(t, hh, "DELETE", "/api/transactions/t1", nil, nil)
	require(t, 200, code, b)
	if _, e := second.read(); e != nil {
		t.Fatal(e)
	}
	if _, e := s.read(); e != nil {
		t.Fatal(e)
	}
}
func TestSecurityAndCSV(t *testing.T) {
	_, h := harness(t)
	code, b := call(t, h, "POST", "/api/parse-import", []byte("data;importo\n2026-01-02;29,50\n"), map[string]string{"Content-Type": "application/octet-stream", "X-Quadra-Filename": "conto.csv"})
	require(t, 200, code, b)
	if !bytes.Contains(b, []byte(`"source_row":2`)) {
		t.Fatal("import structure invalid", string(b))
	}
	req, _ := http.NewRequest("POST", h.URL+"/api/pre-import-backup", nil)
	req.Header.Set("Origin", "https://evil.example")
	res, e := h.Client().Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatalf("cross-origin accepted: %d", res.StatusCode)
	}
	req2, _ := http.NewRequest("GET", h.URL+"/api/state", nil)
	req2.Host = "evil.example"
	res2, e := h.Client().Do(req2)
	if e != nil {
		t.Fatal(e)
	}
	defer res2.Body.Close()
	if res2.StatusCode != 403 {
		t.Fatalf("untrusted Host accepted: %d", res2.StatusCode)
	}
}
func TestXLSXImport(t *testing.T) {
	_, h := harness(t)
	buf := new(bytes.Buffer)
	z := zip.NewWriter(buf)
	files := map[string]string{
		"xl/workbook.xml":            `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="EC-Nov" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`,
		"xl/worksheets/sheet1.xml":   `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Data</t></is></c><c r="B1" t="inlineStr"><is><t>Importo</t></is></c></row><row r="2"><c r="A2"><v>46000</v></c><c r="B2"><v>20.5</v></c></row></sheetData></worksheet>`,
	}
	for name, value := range files {
		f, e := z.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.Write([]byte(value)); e != nil {
			t.Fatal(e)
		}
	}
	if e := z.Close(); e != nil {
		t.Fatal(e)
	}
	code, b := call(t, h, "POST", "/api/parse-import", buf.Bytes(), map[string]string{"Content-Type": "application/octet-stream", "X-Quadra-Filename": "test.xlsx"})
	require(t, 200, code, b)
	if !bytes.Contains(b, []byte("EC-Nov")) || !bytes.Contains(b, []byte("20.5")) {
		t.Fatal(fmt.Sprintf("xlsx result unexpected: %s", b))
	}
}
func TestLockAndMaliciousBackup(t *testing.T) {
	s, h := harness(t)
	release, e := lockDirectory(s.dir)
	if e != nil {
		t.Fatal(e)
	}
	if _, e2 := lockDirectory(s.dir); e2 == nil {
		t.Fatal("second writer lock was allowed")
	}
	release()
	buf := new(bytes.Buffer)
	w := zip.NewWriter(buf)
	f, _ := w.Create("../outside.txt")
	_, _ = f.Write([]byte("nope"))
	_ = w.Close()
	code, b := call(t, h, "POST", "/api/archives/inspect", buf.Bytes(), map[string]string{"X-Quadra-Filename": "attacco.zip"})
	require(t, 400, code, b)
}
