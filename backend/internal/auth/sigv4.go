package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

var ErrInvalidSignature = errors.New("SignatureDoesNotMatch")

// SigV4Request holds parsed AWS Signature Version 4 parameters from either Authorization header or query string.
type SigV4Request struct {
	AccessKeyID   string
	Date          string // YYYYMMDD
	Region        string
	Service       string
	SignedHeaders []string
	Signature     string
	AmzDate       string // YYYYMMDDTHHMMSSZ
	IsPresigned   bool
	Expires       int64
}

// IsSigV4Request reports whether an HTTP request carries AWS SigV4 credentials.
func IsSigV4Request(r *http.Request) bool {
	authHdr := r.Header.Get("Authorization")
	if strings.HasPrefix(authHdr, "AWS4-HMAC-SHA256 ") {
		return true
	}
	return r.URL.Query().Get("X-Amz-Algorithm") == "AWS4-HMAC-SHA256"
}

// ParseSigV4 extracts SigV4 metadata from header or presigned query params.
func ParseSigV4(r *http.Request) (*SigV4Request, error) {
	q := r.URL.Query()
	if q.Get("X-Amz-Algorithm") == "AWS4-HMAC-SHA256" {
		cred := q.Get("X-Amz-Credential")
		amzDate := q.Get("X-Amz-Date")
		signedHdrs := q.Get("X-Amz-SignedHeaders")
		sig := q.Get("X-Amz-Signature")
		expStr := q.Get("X-Amz-Expires")
		if cred == "" || amzDate == "" || signedHdrs == "" || sig == "" {
			return nil, ErrInvalidSignature
		}
		parts := strings.Split(cred, "/")
		if len(parts) != 5 || parts[4] != "aws4_request" {
			return nil, ErrInvalidSignature
		}
		exp := int64(3600)
		if expStr != "" {
			parsed, err := strconv.ParseInt(expStr, 10, 64)
			if err != nil || parsed <= 0 {
				return nil, ErrInvalidSignature
			}
			exp = parsed
		}
		return &SigV4Request{
			AccessKeyID:   parts[0],
			Date:          parts[1],
			Region:        parts[2],
			Service:       parts[3],
			SignedHeaders: strings.Split(signedHdrs, ";"),
			Signature:     sig,
			AmzDate:       amzDate,
			IsPresigned:   true,
			Expires:       exp,
		}, nil
	}

	authHdr := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHdr, "AWS4-HMAC-SHA256 ") {
		return nil, ErrInvalidSignature
	}
	rest := strings.TrimPrefix(authHdr, "AWS4-HMAC-SHA256 ")
	kv := map[string]string{}
	for _, part := range strings.Split(rest, ",") {
		part = strings.TrimSpace(part)
		idx := strings.IndexByte(part, '=')
		if idx <= 0 {
			continue
		}
		kv[strings.TrimSpace(part[:idx])] = strings.TrimSpace(part[idx+1:])
	}
	cred := kv["Credential"]
	signedHdrs := kv["SignedHeaders"]
	sig := kv["Signature"]
	amzDate := r.Header.Get("X-Amz-Date")
	if amzDate == "" {
		amzDate = r.Header.Get("Date")
	}
	if cred == "" || signedHdrs == "" || sig == "" || amzDate == "" {
		return nil, ErrInvalidSignature
	}
	parts := strings.Split(cred, "/")
	if len(parts) != 5 || parts[4] != "aws4_request" {
		return nil, ErrInvalidSignature
	}
	return &SigV4Request{
		AccessKeyID:   parts[0],
		Date:          parts[1],
		Region:        parts[2],
		Service:       parts[3],
		SignedHeaders: strings.Split(signedHdrs, ";"),
		Signature:     sig,
		AmzDate:       amzDate,
		IsPresigned:   false,
	}, nil
}

// VerifySigV4 checks timestamp validity and HMAC-SHA256 signature against secretAccessKey.
func VerifySigV4(r *http.Request, parsed *SigV4Request, secretAccessKey string) error {
	reqTime, err := time.Parse("20060102T150405Z", parsed.AmzDate)
	if err != nil {
		return ErrInvalidSignature
	}
	now := time.Now().UTC()
	if parsed.IsPresigned {
		if now.After(reqTime.Add(time.Duration(parsed.Expires) * time.Second)) {
			return errors.New("Request has expired")
		}
		if reqTime.After(now.Add(15 * time.Minute)) {
			return ErrInvalidSignature
		}
	} else {
		diff := now.Sub(reqTime)
		if diff < -15*time.Minute || diff > 15*time.Minute {
			return ErrInvalidSignature
		}
	}

	canonicalURI := canonicalizeURI(r.URL.EscapedPath())
	canonicalQuery := canonicalizeQuery(r.URL.Query(), parsed.IsPresigned)
	canonicalHeaders, signedHeadersStr := canonicalizeHeaders(r, parsed.SignedHeaders)

	payloadHash := r.Header.Get("X-Amz-Content-Sha256")
	if payloadHash == "" {
		payloadHash = "UNSIGNED-PAYLOAD"
	}
	if parsed.IsPresigned && r.URL.Query().Get("X-Amz-Content-Sha256") == "" && r.Header.Get("X-Amz-Content-Sha256") == "" {
		payloadHash = "UNSIGNED-PAYLOAD"
	}

	canonicalRequest := strings.Join([]string{
		r.Method,
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		signedHeadersStr,
		payloadHash,
	}, "\n")

	crSum := sha256.Sum256([]byte(canonicalRequest))
	scope := strings.Join([]string{parsed.Date, parsed.Region, parsed.Service, "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		parsed.AmzDate,
		scope,
		hex.EncodeToString(crSum[:]),
	}, "\n")

	signingKey := deriveSigningKey(secretAccessKey, parsed.Date, parsed.Region, parsed.Service)
	expectedSig := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	if !hmac.Equal([]byte(strings.ToLower(expectedSig)), []byte(strings.ToLower(parsed.Signature))) {
		return ErrInvalidSignature
	}
	return nil
}

func deriveSigningKey(secret, date, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(date))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(data)
	return mac.Sum(nil)
}

func canonicalizeURI(escapedPath string) string {
	if escapedPath == "" {
		return "/"
	}
	// Ensure each segment uses strict RFC3986 encoding (keeping '/')
	decoded, err := url.PathUnescape(escapedPath)
	if err != nil {
		return escapedPath
	}
	segs := strings.Split(decoded, "/")
	for i, seg := range segs {
		segs[i] = awsURIEncode(seg, false)
	}
	res := strings.Join(segs, "/")
	if !strings.HasPrefix(res, "/") {
		res = "/" + res
	}
	return res
}

func canonicalizeQuery(values url.Values, isPresigned bool) string {
	type pair struct{ k, v string }
	var pairs []pair
	for k, vs := range values {
		if isPresigned && strings.EqualFold(k, "X-Amz-Signature") {
			continue
		}
		ek := awsURIEncode(k, true)
		if len(vs) == 0 {
			pairs = append(pairs, pair{ek, ""})
			continue
		}
		for _, v := range vs {
			pairs = append(pairs, pair{ek, awsURIEncode(v, true)})
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].k == pairs[j].k {
			return pairs[i].v < pairs[j].v
		}
		return pairs[i].k < pairs[j].k
	})
	parts := make([]string, 0, len(pairs))
	for _, p := range pairs {
		parts = append(parts, p.k+"="+p.v)
	}
	return strings.Join(parts, "&")
}

func canonicalizeHeaders(r *http.Request, signedHeaders []string) (string, string) {
	lower := make([]string, 0, len(signedHeaders))
	for _, h := range signedHeaders {
		h = strings.ToLower(strings.TrimSpace(h))
		if h != "" {
			lower = append(lower, h)
		}
	}
	sort.Strings(lower)

	var b strings.Builder
	for _, h := range lower {
		var val string
		if h == "host" {
			val = r.Host
		} else {
			vals := r.Header.Values(h)
			trimmed := make([]string, 0, len(vals))
			for _, v := range vals {
				trimmed = append(trimmed, collapseSpaces(strings.TrimSpace(v)))
			}
			val = strings.Join(trimmed, ",")
		}
		b.WriteString(h)
		b.WriteByte(':')
		b.WriteString(val)
		b.WriteByte('\n')
	}
	return b.String(), strings.Join(lower, ";")
}

func collapseSpaces(s string) string {
	var b strings.Builder
	inSpace := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c == ' ' || c == '\t' {
			if !inSpace {
				b.WriteByte(' ')
				inSpace = true
			}
		} else {
			b.WriteByte(c)
			inSpace = false
		}
	}
	return b.String()
}

func awsURIEncode(s string, encodeSlash bool) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '~' || c == '.' {
			b.WriteByte(c)
		} else if c == '/' && !encodeSlash {
			b.WriteByte('/')
		} else {
			const hexDigits = "0123456789ABCDEF"
			b.WriteByte('%')
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&0x0F])
		}
	}
	return b.String()
}

