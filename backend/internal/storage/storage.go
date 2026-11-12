package storage

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

var (
	ErrTooLarge = errors.New("file exceeds maximum allowed size")
	ErrInvalidKey = errors.New("invalid object key")
)

// StoredBlob describes the result of streaming an upload to disk.
type StoredBlob struct {
	StoragePath string
	SizeBytes   int64
	ETag        string
	SHA256      string
	SniffedMIME string
}

// LocalDriver stores objects on the local filesystem using sharded directories and atomic commits.
type LocalDriver struct {
	rootDir  string
	blobsDir string
	tmpDir   string
	cacheDir string
}

func NewLocalDriver(dataDir string) (*LocalDriver, error) {
	blobsDir := filepath.Join(dataDir, "blobs")
	tmpDir := filepath.Join(dataDir, "tmp")
	cacheDir := filepath.Join(dataDir, "cache")
	for _, d := range []string{blobsDir, tmpDir, cacheDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, fmt.Errorf("init storage dir %s: %w", d, err)
		}
	}
	return &LocalDriver{
		rootDir:  dataDir,
		blobsDir: blobsDir,
		tmpDir:   tmpDir,
		cacheDir: cacheDir,
	}, nil
}

func (d *LocalDriver) CacheDir() string {
	return d.cacheDir
}

// SanitizeKey cleans and validates an object key to prevent path traversal.
func SanitizeKey(raw string) (string, error) {
	cleaned := strings.TrimLeft(strings.TrimSpace(raw), "/")
	if cleaned == "" {
		return "", ErrInvalidKey
	}
	if strings.ContainsRune(cleaned, '\x00') {
		return "", ErrInvalidKey
	}
	parts := strings.Split(cleaned, "/")
	for _, p := range parts {
		if p == ".." || p == "." || p == "" {
			// Disallow empty segments like a//b or traversal segments
			if p == ".." || p == "." {
				return "", ErrInvalidKey
			}
		}
	}
	return cleaned, nil
}

// WriteStream streams r into a temp file while computing MD5, SHA256, byte count, and magic-byte MIME,
// enforcing maxBytes if > 0, and atomically moves it into the sharded blob directory.
func (d *LocalDriver) WriteStream(bucketID string, r io.Reader, maxBytes int64, keyHint string) (*StoredBlob, error) {
	tmpFile, err := os.CreateTemp(d.tmpDir, "upload-*")
	if err != nil {
		return nil, err
	}
	tmpPath := tmpFile.Name()
	cleanupTmp := true
	defer func() {
		_ = tmpFile.Close()
		if cleanupTmp {
			_ = os.Remove(tmpPath)
		}
	}()

	var limitedReader io.Reader = r
	if maxBytes > 0 {
		limitedReader = io.LimitReader(r, maxBytes+1)
	}

	md5Hash := md5.New()
	shaHash := sha256.New()
	mw := io.MultiWriter(tmpFile, md5Hash, shaHash)

	var sniffBuf [512]byte
	sniffLen := 0
	buf := make([]byte, 64*1024)
	var total int64

	for {
		n, readErr := limitedReader.Read(buf)
		if n > 0 {
			if sniffLen < len(sniffBuf) {
				toCopy := len(sniffBuf) - sniffLen
				if n < toCopy {
					toCopy = n
				}
				copy(sniffBuf[sniffLen:], buf[:toCopy])
				sniffLen += toCopy
			}
			total += int64(n)
			if maxBytes > 0 && total > maxBytes {
				return nil, ErrTooLarge
			}
			if _, writeErr := mw.Write(buf[:n]); writeErr != nil {
				return nil, writeErr
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return nil, readErr
		}
	}

	if err := tmpFile.Close(); err != nil {
		return nil, err
	}

	etag := hex.EncodeToString(md5Hash.Sum(nil))
	shaHex := hex.EncodeToString(shaHash.Sum(nil))
	sniffed := DetectMIME(sniffBuf[:sniffLen], keyHint)

	blobID := uuid.NewString()
	relPath := filepath.Join(bucketID, blobID[:2], blobID)
	finalPath := filepath.Join(d.blobsDir, relPath)
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return nil, err
	}
	cleanupTmp = false

	return &StoredBlob{
		StoragePath: relPath,
		SizeBytes:   total,
		ETag:        etag,
		SHA256:      shaHex,
		SniffedMIME: sniffed,
	}, nil
}

// WritePart streams a multipart upload chunk into tmp storage.
func (d *LocalDriver) WritePart(uploadID string, partNumber int, r io.Reader) (relPath string, size int64, etag string, err error) {
	partDir := filepath.Join(d.tmpDir, "parts", uploadID)
	if err := os.MkdirAll(partDir, 0o755); err != nil {
		return "", 0, "", err
	}
	partName := fmt.Sprintf("part-%05d-%s", partNumber, uuid.NewString()[:8])
	tmpPath := filepath.Join(partDir, partName)
	f, err := os.Create(tmpPath)
	if err != nil {
		return "", 0, "", err
	}
	defer f.Close()

	md5Hash := md5.New()
	n, err := io.Copy(io.MultiWriter(f, md5Hash), r)
	if err != nil {
		_ = os.Remove(tmpPath)
		return "", 0, "", err
	}
	rel := filepath.Join("parts", uploadID, partName)
	return rel, n, hex.EncodeToString(md5Hash.Sum(nil)), nil
}

// AssembleParts concatenates ordered part files into a final sharded blob atomically.
func (d *LocalDriver) AssembleParts(bucketID string, partRelPaths []string, maxBytes int64, keyHint string) (*StoredBlob, error) {
	tmpFile, err := os.CreateTemp(d.tmpDir, "assemble-*")
	if err != nil {
		return nil, err
	}
	tmpPath := tmpFile.Name()
	cleanupTmp := true
	defer func() {
		_ = tmpFile.Close()
		if cleanupTmp {
			_ = os.Remove(tmpPath)
		}
	}()

	md5Hash := md5.New()
	shaHash := sha256.New()
	mw := io.MultiWriter(tmpFile, md5Hash, shaHash)

	var total int64
	var sniffBuf [512]byte
	sniffLen := 0

	for _, rel := range partRelPaths {
		fullPartPath := filepath.Join(d.tmpDir, rel)
		pf, err := os.Open(fullPartPath)
		if err != nil {
			return nil, fmt.Errorf("open part %s: %w", rel, err)
		}
		if sniffLen < len(sniffBuf) {
			n, _ := pf.Read(sniffBuf[sniffLen:])
			if n > 0 {
				if _, err := mw.Write(sniffBuf[sniffLen : sniffLen+n]); err != nil {
					_ = pf.Close()
					return nil, err
				}
				sniffLen += n
				total += int64(n)
			}
		}
		n, err := io.Copy(mw, pf)
		_ = pf.Close()
		if err != nil {
			return nil, err
		}
		total += n
		if maxBytes > 0 && total > maxBytes {
			return nil, ErrTooLarge
		}
	}

	if err := tmpFile.Close(); err != nil {
		return nil, err
	}

	blobID := uuid.NewString()
	relPath := filepath.Join(bucketID, blobID[:2], blobID)
	finalPath := filepath.Join(d.blobsDir, relPath)
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return nil, err
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return nil, err
	}
	cleanupTmp = false

	return &StoredBlob{
		StoragePath: relPath,
		SizeBytes:   total,
		ETag:        hex.EncodeToString(md5Hash.Sum(nil)),
		SHA256:      hex.EncodeToString(shaHash.Sum(nil)),
		SniffedMIME: DetectMIME(sniffBuf[:sniffLen], keyHint),
	}, nil
}

// CopyBlob duplicates an existing blob on disk into a new sharded blob path.
func (d *LocalDriver) CopyBlob(dstBucketID, srcRelPath string) (string, error) {
	srcPath := d.AbsBlobPath(srcRelPath)
	src, err := os.Open(srcPath)
	if err != nil {
		return "", err
	}
	defer src.Close()

	tmpFile, err := os.CreateTemp(d.tmpDir, "copy-*")
	if err != nil {
		return "", err
	}
	tmpPath := tmpFile.Name()
	cleanupTmp := true
	defer func() {
		_ = tmpFile.Close()
		if cleanupTmp {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := io.Copy(tmpFile, src); err != nil {
		return "", err
	}
	if err := tmpFile.Close(); err != nil {
		return "", err
	}

	blobID := uuid.NewString()
	relPath := filepath.Join(dstBucketID, blobID[:2], blobID)
	finalPath := filepath.Join(d.blobsDir, relPath)
	if err := os.MkdirAll(filepath.Dir(finalPath), 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(tmpPath, finalPath); err != nil {
		return "", err
	}
	cleanupTmp = false
	return relPath, nil
}

func (d *LocalDriver) AbsBlobPath(relPath string) string {
	return filepath.Join(d.blobsDir, relPath)
}

func (d *LocalDriver) OpenBlob(relPath string) (*os.File, error) {
	return os.Open(d.AbsBlobPath(relPath))
}

func (d *LocalDriver) DeleteBlob(relPath string) error {
	if relPath == "" {
		return nil
	}
	err := os.Remove(d.AbsBlobPath(relPath))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (d *LocalDriver) DeletePartsDir(uploadID string) {
	_ = os.RemoveAll(filepath.Join(d.tmpDir, "parts", uploadID))
}

// DetectMIME combines magic-byte detection with extension fallback for text/svg/json/css/js.
func DetectMIME(header []byte, keyHint string) string {
	sniffed := http.DetectContentType(header)
	ext := strings.ToLower(filepath.Ext(keyHint))
	if ext != "" {
		if byExt := mime.TypeByExtension(ext); byExt != "" {
			// Prefer extension MIME for text-based or container formats where magic bytes are generic.
			if strings.HasPrefix(sniffed, "text/plain") || sniffed == "application/octet-stream" || ext == ".svg" || ext == ".json" || ext == ".css" || ext == ".js" || ext == ".mjs" || ext == ".ts" || ext == ".webp" {
				if idx := strings.Index(byExt, ";"); idx != -1 {
					byExt = strings.TrimSpace(byExt[:idx])
				}
				return byExt
			}
		}
	}
	if idx := strings.Index(sniffed, ";"); idx != -1 {
		sniffed = strings.TrimSpace(sniffed[:idx])
	}
	if sniffed == "" {
		return "application/octet-stream"
	}
	return sniffed
}

