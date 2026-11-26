package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

func TestHistoricalCompatibility(t *testing.T) {
	zipPath := os.Getenv("QUADRA_LEGACY_ZIP")
	if zipPath == "" {
		t.Skip("historical archive not supplied")
	}
	raw, e := os.ReadFile(zipPath)
	if e != nil {
		t.Fatal(e)
	}
	s, e := makeStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	seed, e := assets.ReadFile("assets/templates/archivio_iniziale.json")
	if e != nil {
		t.Fatal(e)
	}
	var fallback map[string]any
	_ = json.Unmarshal(seed, &fallback)
	pkg, e := readRestore(raw, "backup.zip", arr(fallback["categories"]))
	if e != nil {
		t.Fatal(e)
	}
	if len(arr(pkg.data["transactions"])) == 0 {
		t.Fatal("historic records missing")
	}
	report, e := s.restore(pkg)
	if e != nil {
		t.Fatal(e)
	}
	data, e := s.read()
	if e != nil {
		t.Fatal(e)
	}
	if len(arr(data["transactions"])) != len(arr(pkg.data["transactions"])) {
		t.Fatalf("unexpected count report: %v", report)
	}
}
func TestRealXLSXCompatibility(t *testing.T) {
	p := os.Getenv("QUADRA_SOURCE_XLSX")
	if p == "" {
		t.Skip("spreadsheet not supplied")
	}
	raw, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	got, e := parseUpload(raw, "originale.xlsx", "EC-Ott")
	if e != nil {
		t.Fatal(e)
	}
	if len(got["rows"].([]rowEntry)) < 30 {
		t.Fatal("too few rows parsed")
	}
	if !bytes.Contains([]byte(fmt.Sprint(got["rows"])), []byte("2026")) {
		t.Log("Dates may be stored as Excel serial values (as in original backend)")
	}
}
