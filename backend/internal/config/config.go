package config

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Config holds runtime configuration for the Serevox server.
type Config struct {
	Port           string
	PublicURL      string
	DataDir        string
	DBPath         string
	MasterKey      []byte
	StaticDir      string
	MaxUploadBytes int64
	AllowedOrigins []string

	MidtransServerKey string
	MidtransClientKey string
	MidtransIsProd    bool
}

// Load reads configuration from environment variables with sensible local defaults.
func Load() (*Config, error) {
	port := getEnv("SEREVOX_PORT", "8080")
	publicURL := strings.TrimRight(getEnv("SEREVOX_PUBLIC_URL", "http://localhost:"+port), "/")
	dataDir := getEnv("SEREVOX_DATA_DIR", "./data")
	dbPath := getEnv("SEREVOX_DB_PATH", filepath.Join(dataDir, "serevox.db"))
	staticDir := getEnv("SEREVOX_STATIC_DIR", "../web/dist")

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}

	maxUpload := int64(5) * 1024 * 1024 * 1024 // 5 GiB
	if raw := os.Getenv("SEREVOX_MAX_UPLOAD_BYTES"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil && parsed > 0 {
			maxUpload = parsed
		}
	}

	masterKey, err := loadOrCreateMasterKey(dataDir, os.Getenv("SEREVOX_MASTER_KEY"))
	if err != nil {
		return nil, err
	}

	originsRaw := getEnv("SEREVOX_CORS_ORIGINS", "*")
	var origins []string
	for _, o := range strings.Split(originsRaw, ",") {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}

	return &Config{
		Port:              port,
		PublicURL:         publicURL,
		DataDir:           dataDir,
		DBPath:            dbPath,
		MasterKey:         masterKey,
		StaticDir:         staticDir,
		MaxUploadBytes:    maxUpload,
		AllowedOrigins:    origins,
		MidtransServerKey: getEnv("MIDTRANS_SERVER_KEY", "SB-Mid-server-5y5ZIlFc5yMRtomK4U5l05Hx"),
		MidtransClientKey: getEnv("MIDTRANS_CLIENT_KEY", "SB-Mid-client-axI.ER5L_Xy~RQYdmtuvTAxC"),
		MidtransIsProd:    getEnv("MIDTRANS_IS_PROD", "false") == "true",
	}, nil
}

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func loadOrCreateMasterKey(dataDir, envVal string) ([]byte, error) {
	if strings.TrimSpace(envVal) != "" {
		// Derive deterministic 32-byte key from hex or raw string.
		if decoded, err := hex.DecodeString(strings.TrimSpace(envVal)); err == nil && len(decoded) >= 32 {
			return decoded[:32], nil
		}
		buf := make([]byte, 32)
		copy(buf, []byte(envVal))
		return buf, nil
	}

	keyFile := filepath.Join(dataDir, ".master_key")
	if b, err := os.ReadFile(keyFile); err == nil {
		if decoded, err := hex.DecodeString(strings.TrimSpace(string(b))); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyFile, []byte(hex.EncodeToString(raw)), 0o600); err != nil {
		return nil, err
	}
	return raw, nil
}

