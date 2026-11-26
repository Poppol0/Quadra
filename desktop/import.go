package main

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const maxImport = 12 * 1024 * 1024
const maxImportUnpacked = 40 * 1024 * 1024
const maxRows = 12000
const maxColumns = 55

type sheetInfo struct {
	Name string
	Path string
}
type rowEntry struct {
	SourceRow int      `json:"source_row"`
	Cells     []string `json:"cells"`
}

func parseUpload(raw []byte, filename, chosen string) (map[string]any, error) {
	if len(raw) == 0 || len(raw) > maxImport {
		return nil, errors.New("file vuoto o troppo grande (max 12 MB)")
	}
	lower := strings.ToLower(filename)
	if strings.HasSuffix(lower, ".csv") || strings.HasSuffix(lower, ".txt") {
		return parseCSV(raw)
	}
	if strings.HasSuffix(lower, ".xlsx") {
		return parseXLSX(raw, chosen)
	}
	return nil, errors.New("sono supportati XLSX e CSV")
}
func windows1252(raw []byte) string {
	special := map[byte]rune{
		0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž',
		0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
	}
	var out strings.Builder
	for _, c := range raw {
		if c < 0x80 {
			out.WriteByte(c)
		} else if x, ok := special[c]; ok {
			out.WriteRune(x)
		} else {
			out.WriteRune(rune(c))
		}
	}
	return out.String()
}
func detectSeparator(sample string) rune {
	var winner rune = ';'
	best := -1
	// Prefer a stable field count, not the largest number of separators:
	// monetary decimals may contain more commas than the CSV has columns.
	for _, sep := range []rune{';', ',', '\t', '|'} {
		reader := csv.NewReader(strings.NewReader(sample))
		reader.Comma = sep
		reader.FieldsPerRecord = -1
		reader.LazyQuotes = true
		counts := map[int]int{}
		valid := 0
		for valid < 18 {
			row, err := reader.Read()
			if err != nil {
				break
			}
			if len(row) == 1 && strings.TrimSpace(row[0]) == "" {
				continue
			}
			counts[len(row)]++
			valid++
		}
		mostCount, mostRows := 0, 0
		for count, rows := range counts {
			if count > 1 && (rows > mostRows || (rows == mostRows && count > mostCount)) {
				mostCount = count
				mostRows = rows
			}
		}
		if valid == 0 || mostCount == 0 {
			continue
		}
		score := mostRows*1000/valid + min(mostCount, 50)
		if score > best {
			best = score
			winner = sep
		}
	}
	return winner
}
func parseCSV(raw []byte) (map[string]any, error) {
	if bytes.IndexByte(raw[:min(len(raw), 2000)], 0) >= 0 {
		return nil, errors.New("contenuto CSV non valido")
	}
	var text string
	if utf8.Valid(raw) {
		text = string(raw)
	} else {
		text = windows1252(raw)
	}
	text = strings.TrimPrefix(text, "\ufeff")
	sample := text[:min(8192, len(text))]
	reader := csv.NewReader(strings.NewReader(text))
	reader.Comma = detectSeparator(sample)
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	rows := []rowEntry{}
	idx := 0
	for {
		vals, e := reader.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		idx++
		nonempty := false
		for _, v := range vals {
			if strings.TrimSpace(v) != "" {
				nonempty = true
				break
			}
		}
		if !nonempty {
			continue
		}
		if len(vals) > maxColumns {
			vals = vals[:maxColumns]
		}
		rows = append(rows, rowEntry{idx, vals})
		if len(rows) >= maxRows {
			break
		}
	}
	if len(rows) == 0 {
		return nil, errors.New("nessuna riga con valori")
	}
	return map[string]any{"file_type": "csv", "sheet": "CSV", "sheets": []string{"CSV"}, "rows": rows, "truncated": len(rows) >= maxRows}, nil
}
func unzipBytes(z *zip.File) ([]byte, error) {
	r, e := z.Open()
	if e != nil {
		return nil, e
	}
	defer r.Close()
	return io.ReadAll(io.LimitReader(r, maxImportUnpacked+1))
}
func extractSheetNames(content []byte) ([]sheetInfo, map[string]*zip.File, error) {
	r, e := zip.NewReader(bytes.NewReader(content), int64(len(content)))
	if e != nil {
		return nil, nil, e
	}
	files := map[string]*zip.File{}
	sum := int64(0)
	for _, f := range r.File {
		sum += int64(f.UncompressedSize64)
		if sum > maxImportUnpacked {
			return nil, nil, errors.New("XLSX decompressa troppo grande")
		}
		files[f.Name] = f
	}
	if files["xl/workbook.xml"] == nil || files["xl/_rels/workbook.xml.rels"] == nil {
		return nil, nil, errors.New("workbook XLSX non valido")
	}
	wb, _ := unzipBytes(files["xl/workbook.xml"])
	rels, _ := unzipBytes(files["xl/_rels/workbook.xml.rels"])
	mappings := map[string]string{}
	dec := xml.NewDecoder(bytes.NewReader(rels))
	for {
		tok, e := dec.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, nil, e
		}
		st, ok := tok.(xml.StartElement)
		if !ok || st.Name.Local != "Relationship" {
			continue
		}
		id, target := "", ""
		for _, a := range st.Attr {
			if a.Name.Local == "Id" {
				id = a.Value
			}
			if a.Name.Local == "Target" {
				target = a.Value
			}
		}
		if id != "" {
			mappings[id] = target
		}
	}
	dec = xml.NewDecoder(bytes.NewReader(wb))
	sheets := []sheetInfo{}
	for {
		tok, e := dec.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, nil, e
		}
		st, ok := tok.(xml.StartElement)
		if !ok || st.Name.Local != "sheet" {
			continue
		}
		name, rid := "", ""
		for _, a := range st.Attr {
			if a.Name.Local == "name" {
				name = a.Value
			}
			if a.Name.Local == "id" {
				rid = a.Value
			}
		}
		target := mappings[rid]
		if target == "" {
			continue
		}
		p := target
		if strings.HasPrefix(p, "/") {
			p = strings.TrimPrefix(p, "/")
		} else if !strings.HasPrefix(p, "xl/") {
			p = "xl/" + p
		}
		p = path.Clean(p)
		if !strings.HasPrefix(p, "xl/") || files[p] == nil {
			continue
		}
		sheets = append(sheets, sheetInfo{name, p})
	}
	return sheets, files, nil
}
func sharedStrings(f *zip.File) ([]string, error) {
	if f == nil {
		return nil, nil
	}
	data, e := unzipBytes(f)
	if e != nil {
		return nil, e
	}
	dec := xml.NewDecoder(bytes.NewReader(data))
	result := []string{}
	inSI := false
	inT := false
	var sb strings.Builder
	for {
		tok, e := dec.Token()
		if e == io.EOF {
			break
		}
		if e != nil {
			return nil, e
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if t.Name.Local == "si" {
				inSI = true
				sb.Reset()
			} else if inSI && t.Name.Local == "t" {
				inT = true
			}
		case xml.EndElement:
			if t.Name.Local == "si" && inSI {
				result = append(result, sb.String())
				inSI = false
			} else if t.Name.Local == "t" {
				inT = false
			}
		case xml.CharData:
			if inT && inSI {
				sb.Write([]byte(t))
			}
		}
	}
	return result, nil
}

var cellRef = regexp.MustCompile(`^[A-Z]+`)

func cellIndex(code string) int {
	column := cellRef.FindString(code)
	n := 0
	for _, r := range column {
		n = n*26 + int(r-'A') + 1
	}
	return n - 1
}
func parseXLSX(content []byte, chosen string) (map[string]any, error) {
	sheets, files, e := extractSheetNames(content)
	if e != nil {
		return nil, e
	}
	if len(sheets) == 0 {
		return nil, errors.New("nessun foglio XLSX leggibile")
	}
	target := sheets[0]
	names := []string{}
	for _, v := range sheets {
		names = append(names, v.Name)
		if chosen != "" && chosen == v.Name {
			target = v
		} else if chosen == "" && strings.HasPrefix(strings.ToLower(v.Name), "ec-") {
			target = v
			chosen = v.Name
		}
	}
	if chosen != "" {
		found := false
		for _, v := range sheets {
			if v.Name == chosen {
				found = true
				break
			}
		}
		if !found {
			return nil, errors.New("foglio XLSX non trovato")
		}
	}
	ss, e := sharedStrings(files["xl/sharedStrings.xml"])
	if e != nil {
		return nil, e
	}
	b, e := unzipBytes(files[target.Path])
	if e != nil {
		return nil, e
	}
	dec := xml.NewDecoder(bytes.NewReader(b))
	rows := []rowEntry{}
	rowN := 0
	values := map[int]string{}
	inCell := false
	cellType := ""
	cellN := 0
	cellText := ""
	capture := false
	var text strings.Builder
	cellValue := ""
	inline := false
	flushCell := func() {
		if inCell && cellN >= 0 && cellN < maxColumns {
			v := cellValue
			if cellType == "s" {
				idx, e := strconv.Atoi(v)
				if e == nil && idx >= 0 && idx < len(ss) {
					v = ss[idx]
				} else {
					v = ""
				}
			}
			if v != "" {
				values[cellN] = v
			}
		}
		inCell = false
	}
	for {
		tok, er := dec.Token()
		if er == io.EOF {
			break
		}
		if er != nil {
			return nil, er
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "row":
				values = map[int]string{}
				rowN++
				for _, a := range t.Attr {
					if a.Name.Local == "r" {
						n, e := strconv.Atoi(a.Value)
						if e == nil {
							rowN = n
						}
					}
				}
			case "c":
				inCell = true
				cellType = ""
				cellN = -1
				cellValue = ""
				inline = false
				for _, a := range t.Attr {
					if a.Name.Local == "r" {
						cellN = cellIndex(a.Value)
					}
					if a.Name.Local == "t" {
						cellType = a.Value
					}
				}
			case "is":
				if inCell {
					inline = true
				}
			case "v", "t":
				if inCell {
					if t.Name.Local == "v" || inline {
						capture = true
						text.Reset()
						cellText = t.Name.Local
					}
				}
			}
		case xml.EndElement:
			switch t.Name.Local {
			case "v", "t":
				if capture && t.Name.Local == cellText {
					if inline && t.Name.Local == "t" {
						cellValue += text.String()
					} else {
						cellValue = text.String()
					}
					capture = false
				}
			case "c":
				flushCell()
			case "row":
				if len(values) > 0 {
					maxCol := 0
					for i := range values {
						if i > maxCol {
							maxCol = i
						}
					}
					cells := make([]string, maxCol+1)
					nonblank := false
					for i, s := range values {
						cells[i] = s
						if strings.TrimSpace(s) != "" {
							nonblank = true
						}
					}
					if nonblank {
						rows = append(rows, rowEntry{rowN, cells})
					}
				}
				if len(rows) >= maxRows {
					goto done
				}
			}
		case xml.CharData:
			if capture {
				text.Write([]byte(t))
			}
		}
	}
done:
	if len(rows) == 0 {
		return nil, errors.New("nessuna riga con valori")
	}
	return map[string]any{"file_type": "xlsx", "sheet": target.Name, "sheets": names, "rows": rows, "truncated": len(rows) >= maxRows}, nil
}
func debugSheets(content []byte) string {
	s, _, e := extractSheetNames(content)
	if e != nil {
		return fmt.Sprint(e)
	}
	return fmt.Sprintf("%v", s)
}
