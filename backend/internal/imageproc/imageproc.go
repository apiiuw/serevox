package imageproc

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"image"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/disintegration/imaging"
	_ "golang.org/x/image/webp"
)

const MaxDimension = 4096

// Options defines requested on-the-fly image transformations.
type Options struct {
	Width   int
	Height  int
	Fit     string // cover, contain, fill
	Quality int    // 1..100
	Format  string // jpeg, png, gif
}

// ParseOptions extracts image transform query parameters. Returns ok=false if no transformation was requested.
func ParseOptions(r *http.Request) (Options, bool) {
	q := r.URL.Query()
	wStr := firstNonEmpty(q.Get("w"), q.Get("width"))
	hStr := firstNonEmpty(q.Get("h"), q.Get("height"))
	fit := strings.ToLower(strings.TrimSpace(q.Get("fit")))
	fmtStr := strings.ToLower(strings.TrimSpace(firstNonEmpty(q.Get("format"), q.Get("f"))))
	qStr := firstNonEmpty(q.Get("q"), q.Get("quality"))

	if wStr == "" && hStr == "" && fmtStr == "" && qStr == "" && fit == "" {
		return Options{}, false
	}

	opts := Options{
		Fit:     "cover",
		Quality: 82,
	}
	if wStr != "" {
		if v, err := strconv.Atoi(wStr); err == nil && v > 0 {
			if v > MaxDimension {
				v = MaxDimension
			}
			opts.Width = v
		}
	}
	if hStr != "" {
		if v, err := strconv.Atoi(hStr); err == nil && v > 0 {
			if v > MaxDimension {
				v = MaxDimension
			}
			opts.Height = v
		}
	}
	if fit == "contain" || fit == "fill" || fit == "cover" {
		opts.Fit = fit
	}
	if qStr != "" {
		if v, err := strconv.Atoi(qStr); err == nil && v >= 1 && v <= 100 {
			opts.Quality = v
		}
	}
	switch fmtStr {
	case "jpg", "jpeg":
		opts.Format = "jpeg"
	case "png":
		opts.Format = "png"
	case "gif":
		opts.Format = "gif"
	}

	if opts.Width == 0 && opts.Height == 0 && opts.Format == "" && qStr == "" {
		return Options{}, false
	}
	return opts, true
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

// TransformOrCached returns a cached transformed file path and its MIME type, generating it if not cached.
func TransformOrCached(cacheDir, srcAbsPath, etag, srcMIME string, opts Options) (string, string, error) {
	targetFormat := opts.Format
	if targetFormat == "" {
		switch srcMIME {
		case "image/png":
			targetFormat = "png"
		case "image/gif":
			targetFormat = "gif"
		default:
			targetFormat = "jpeg"
		}
	}

	keyRaw := fmt.Sprintf("%s|w=%d|h=%d|fit=%s|q=%d|fmt=%s", etag, opts.Width, opts.Height, opts.Fit, opts.Quality, targetFormat)
	sum := sha256.Sum256([]byte(keyRaw))
	cacheName := hex.EncodeToString(sum[:]) + "." + targetFormat
	cachePath := filepath.Join(cacheDir, cacheName[:2], cacheName)

	if info, err := os.Stat(cachePath); err == nil && info.Size() > 0 {
		return cachePath, "image/" + targetFormat, nil
	}

	srcImg, err := imaging.Open(srcAbsPath, imaging.AutoOrientation(true))
	if err != nil {
		return "", "", err
	}

	var result image.Image = srcImg
	if opts.Width > 0 || opts.Height > 0 {
		w, h := opts.Width, opts.Height
		if w == 0 || h == 0 {
			result = imaging.Resize(srcImg, w, h, imaging.Lanczos)
		} else {
			switch opts.Fit {
			case "contain":
				result = imaging.Fit(srcImg, w, h, imaging.Lanczos)
			case "fill":
				result = imaging.Resize(srcImg, w, h, imaging.Lanczos)
			default: // cover
				result = imaging.Fill(srcImg, w, h, imaging.Center, imaging.Lanczos)
			}
		}
	}

	if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err != nil {
		return "", "", err
	}
	tmpOut := cachePath + ".tmp"
	f, err := os.Create(tmpOut)
	if err != nil {
		return "", "", err
	}

	var encErr error
	switch targetFormat {
	case "png":
		encErr = imaging.Encode(f, result, imaging.PNG)
	case "gif":
		encErr = imaging.Encode(f, result, imaging.GIF)
	default:
		encErr = imaging.Encode(f, result, imaging.JPEG, imaging.JPEGQuality(opts.Quality))
	}
	closeErr := f.Close()
	if encErr != nil {
		_ = os.Remove(tmpOut)
		return "", "", encErr
	}
	if closeErr != nil {
		_ = os.Remove(tmpOut)
		return "", "", closeErr
	}
	if err := os.Rename(tmpOut, cachePath); err != nil {
		_ = os.Remove(tmpOut)
		return "", "", err
	}

	return cachePath, "image/" + targetFormat, nil
}

