package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

//go:embed assets/* assets/templates/*
var assets embed.FS

func main() {
	var serveOnly bool
	var dataFolder string
	var port int
	flag.BoolVar(&serveOnly, "serve-only", false, "Avvia il server locale senza la finestra desktop")
	flag.StringVar(&dataFolder, "data-dir", "", "Percorso assoluto archivio privato")
	flag.IntVar(&port, "port", 8765, "Porta locale (0 = automatica)")
	flag.Parse()
	if err := launch(serveOnly, dataFolder, port); err != nil {
		msg := "Impossibile avviare Quadra:\n\n" + err.Error() + "\n\nI dati sul PC non sono stati eliminati."
		log.Println(msg)
		showError(msg)
		os.Exit(1)
	}
}
func launch(serveOnly bool, folder string, port int) error {
	if folder == "" {
		folder = appDataDir()
	}
	store, err := makeStore(folder)
	if err != nil {
		return err
	}
	unlock, err := lockDirectory(store.dir)
	if err != nil {
		return fmt.Errorf("la cartella dati è già aperta in un'altra sessione di Quadra: %w", err)
	}
	defer unlock()
	logfile := filepath.Join(store.dir, "quadra-desktop.log")
	lf, e := os.OpenFile(logfile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if e == nil {
		defer lf.Close()
		log.SetOutput(lf)
	}
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil && port == 8765 {
		// A stable origin preserves interface preferences and the installed PWA.
		// An occupied port does not prevent using Quadra; take a temporary free port.
		listener, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		return err
	}
	defer listener.Close()
	addr := listener.Addr().String()
	backend := &Server{store: store, host: addr}
	httpd := &http.Server{Handler: http.HandlerFunc(backend.handler), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 45 * time.Second, MaxHeaderBytes: 16384}
	done := make(chan error, 1)
	go func() {
		e := httpd.Serve(listener)
		if e != nil && !errors.Is(e, http.ErrServerClosed) {
			done <- e
		} else {
			done <- nil
		}
	}()
	url := "http://" + addr + "/"
	log.Printf("Quadra avviata. OS=%s. URL=%s", runtime.GOOS, url)
	if serveOnly {
		fmt.Println("Quadra Desktop – modalità manutenzione:", url)
		fmt.Println("Dati privati:", store.dir)
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
		select {
		case <-sig:
		case <-done:
		}
	} else {
		if err := runWindow(url, store.dir); err != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			_ = httpd.Shutdown(ctx)
			return err
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpd.Shutdown(ctx)
	return nil
}
