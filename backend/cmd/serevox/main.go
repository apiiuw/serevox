package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/serevox/serevox/internal/auth"
	"github.com/serevox/serevox/internal/config"
	"github.com/serevox/serevox/internal/console"
	"github.com/serevox/serevox/internal/core"
	"github.com/serevox/serevox/internal/db"
	"github.com/serevox/serevox/internal/restapi"
	"github.com/serevox/serevox/internal/s3api"
	"github.com/serevox/serevox/internal/storage"
	"github.com/serevox/serevox/internal/webhook"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("load config: %v", err)
	}

	store, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer store.Close()

	st, err := storage.NewLocalDriver(cfg.DataDir)
	if err != nil {
		log.Fatalf("init storage: %v", err)
	}

	authSvc := auth.NewService(cfg.MasterKey)
	wh := webhook.NewDispatcher(store)
	svc := core.NewService(cfg, store, st, wh)

	stopWorker := make(chan struct{})
	svc.StartLifecycleWorker(stopWorker)

	s3Handler := s3api.NewHandler(svc, authSvc)
	restHandler := restapi.NewHandler(svc, authSvc)
	consoleHandler := console.NewHandler(svc, authSvc)

	var totalRequests, s3Requests, restRequests atomic.Int64
	startedAt := time.Now().UTC()

	rootHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		totalRequests.Add(1)
		switch {
		case r.URL.Path == "/health" || r.URL.Path == "/ready":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":  "ok",
				"service": "serevox",
				"time":    time.Now().UTC().Format(time.RFC3339),
			})
		case r.URL.Path == "/metrics":
			w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
			uptime := time.Since(startedAt).Seconds()
			_, _ = fmt.Fprintf(w, "# HELP serevox_http_requests_total Total HTTP requests handled\n# TYPE serevox_http_requests_total counter\nserevox_http_requests_total %d\n# HELP serevox_s3_requests_total Total S3 API requests\n# TYPE serevox_s3_requests_total counter\nserevox_s3_requests_total %d\n# HELP serevox_rest_requests_total Total REST API requests\n# TYPE serevox_rest_requests_total counter\nserevox_rest_requests_total %d\n# HELP serevox_uptime_seconds Server uptime in seconds\n# TYPE serevox_uptime_seconds gauge\nserevox_uptime_seconds %.2f\n",
				totalRequests.Load(), s3Requests.Load(), restRequests.Load(), uptime)
		case strings.HasPrefix(r.URL.Path, "/console/api"):
			consoleHandler.ServeHTTP(w, r)
		case strings.HasPrefix(r.URL.Path, "/v1/"):
			restRequests.Add(1)
			restHandler.ServeHTTP(w, r)
		case strings.HasPrefix(r.URL.Path, "/s3/") || r.URL.Path == "/s3":
			s3Requests.Add(1)
			s3Handler.ServeHTTP(w, r, "/s3")
		case auth.IsSigV4Request(r):
			s3Requests.Add(1)
			s3Handler.ServeHTTP(w, r, "")
		default:
			serveSPAOrWelcome(w, r, cfg.StaticDir)
		}
	})

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           rootHandler,
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("Serevox Object Storage listening on %s (public_url=%s, data=%s)", srv.Addr, cfg.PublicURL, cfg.DataDir)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	close(stopWorker)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

func serveSPAOrWelcome(w http.ResponseWriter, r *http.Request, staticDir string) {
	indexPath := filepath.Join(staticDir, "index.html")
	if _, err := os.Stat(indexPath); err == nil {
		cleanPath := filepath.Clean(r.URL.Path)
		candidate := filepath.Join(staticDir, cleanPath)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			http.ServeFile(w, r, candidate)
			return
		}
		http.ServeFile(w, r, indexPath)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"name":    "Serevox Object Storage",
		"tagline": "Razor-sharp, agile object storage inspired by Seregios",
		"endpoints": map[string]string{
			"health":  "/health",
			"s3":      "/s3 (or root with AWS SigV4)",
			"rest":    "/v1/*",
			"console": "/console/api/*",
		},
	})
}

