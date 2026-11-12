package serevox_test

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
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

func newTestServer(t *testing.T) (*httptest.Server, *db.Store, func()) {
	t.Helper()
	tmpDir := t.TempDir()
	cfg := &config.Config{
		Port:           "0",
		DataDir:        tmpDir,
		DBPath:         tmpDir + "/test.db",
		MasterKey:      []byte("0123456789abcdef0123456789abcdef"),
		MaxUploadBytes: 50 * 1024 * 1024,
		AllowedOrigins: []string{"*"},
	}
	store, err := db.Open(cfg.DBPath)
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	st, err := storage.NewLocalDriver(cfg.DataDir)
	if err != nil {
		t.Fatalf("storage: %v", err)
	}
	authSvc := auth.NewService(cfg.MasterKey)
	wh := webhook.NewDispatcher(store)
	svc := core.NewService(cfg, store, st, wh)

	s3h := s3api.NewHandler(svc, authSvc)
	resth := restapi.NewHandler(svc, authSvc)
	consh := console.NewHandler(svc, authSvc)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/console/api"):
			consh.ServeHTTP(w, r)
		case strings.HasPrefix(r.URL.Path, "/v1/"):
			resth.ServeHTTP(w, r)
		case strings.HasPrefix(r.URL.Path, "/s3/") || r.URL.Path == "/s3":
			s3h.ServeHTTP(w, r, "/s3")
		case auth.IsSigV4Request(r):
			s3h.ServeHTTP(w, r, "")
		default:
			http.NotFound(w, r)
		}
	}))
	cfg.PublicURL = srv.URL
	return srv, store, func() {
		srv.Close()
		_ = store.Close()
	}
}

func doJSON(t *testing.T, method, targetURL, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, targetURL, reader)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	var parsed map[string]any
	_ = json.Unmarshal(raw, &parsed)
	return resp, parsed
}

func signS3Request(req *http.Request, ak, sk, region, payloadHex string) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	req.Header.Set("Host", req.URL.Host)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHex)

	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", req.URL.Host, payloadHex, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	q := req.URL.Query()
	canonicalQuery := ""
	if len(q) > 0 {
		canonicalQuery = q.Encode()
	}
	canonicalReq := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHex,
	}, "\n")
	crHash := sha256.Sum256([]byte(canonicalReq))
	scope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)
	strToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hex.EncodeToString(crHash[:]),
	}, "\n")

	hmacFn := func(key, data []byte) []byte {
		m := hmac.New(sha256.New, key)
		m.Write(data)
		return m.Sum(nil)
	}
	kDate := hmacFn([]byte("AWS4"+sk), []byte(dateStamp))
	kRegion := hmacFn(kDate, []byte(region))
	kService := hmacFn(kRegion, []byte("s3"))
	kSigning := hmacFn(kService, []byte("aws4_request"))
	sig := hex.EncodeToString(hmacFn(kSigning, []byte(strToSign)))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		ak, scope, signedHeaders, sig,
	))
}

func makeSamplePNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 229, G: 169, B: 26, A: 255})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func TestEndToEndStorageRESTAndS3(t *testing.T) {
	srv, _, cleanup := newTestServer(t)
	defer cleanup()

	// 1. Setup first admin + default project + starter credentials
	resp, setupRes := doJSON(t, "POST", srv.URL+"/console/api/setup", "", map[string]any{
		"email":        "hunter@serevox.dev",
		"name":         "Seregios Admin",
		"password":     "thousand-blades",
		"project_name": "my-saas-web",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("expected 201 on setup, got %d: %v", resp.StatusCode, setupRes)
	}
	consoleTok := setupRes["token"].(string)
	proj := setupRes["project"].(map[string]any)
	projID := proj["id"].(string)
	creds := setupRes["initial_credentials"].(map[string]any)
	serviceKey := creds["service_role_key"].(string)
	s3AK := creds["s3_access_key_id"].(string)
	s3SK := creds["s3_secret_key"].(string)

	// 2. Create private bucket with MIME restriction
	resp, bRes := doJSON(t, "POST", srv.URL+"/console/api/projects/"+projID+"/buckets", consoleTok, map[string]any{
		"name":               "private-docs",
		"visibility":         "private",
		"max_file_size":      1024 * 1024,
		"allowed_mime_types": []string{"text/plain", "image/*"},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create private bucket failed: %d %v", resp.StatusCode, bRes)
	}

	// 3. REST: Signed upload to private bucket, then blocked public read, then signed download
	resp, signUp := doJSON(t, "POST", srv.URL+"/v1/buckets/private-docs/objects/sign-upload", serviceKey, map[string]any{
		"path":      "notes/hello.txt",
		"expiresIn": 300,
		"upsert":    true,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("sign-upload failed: %d %v", resp.StatusCode, signUp)
	}
	signedUploadURL := signUp["signedUrl"].(string)
	putReq, _ := http.NewRequest("PUT", signedUploadURL, strings.NewReader("Serevox thousand blades storage!"))
	putReq.Header.Set("Content-Type", "text/plain")
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil || putResp.StatusCode != 200 {
		t.Fatalf("signed upload failed: %v status=%v", err, putResp)
	}
	_ = putResp.Body.Close()

	// Public endpoint must reject private bucket
	pubResp, _ := http.Get(srv.URL + "/v1/public/private-docs/notes/hello.txt")
	if pubResp.StatusCode != 403 {
		t.Fatalf("expected 403 for private bucket on public URL, got %d", pubResp.StatusCode)
	}
	_ = pubResp.Body.Close()

	// Signed download URL + HTTP Range request check
	resp, signDl := doJSON(t, "POST", srv.URL+"/v1/buckets/private-docs/objects/sign", serviceKey, map[string]any{
		"path":      "notes/hello.txt",
		"expiresIn": 300,
	})
	if resp.StatusCode != 200 {
		t.Fatalf("sign download failed: %d %v", resp.StatusCode, signDl)
	}
	signedDlURL := signDl["signedUrl"].(string)

	rangeReq, _ := http.NewRequest("GET", signedDlURL, nil)
	rangeReq.Header.Set("Range", "bytes=0-6")
	rangeResp, err := http.DefaultClient.Do(rangeReq)
	if err != nil || rangeResp.StatusCode != 206 {
		t.Fatalf("expected 206 Partial Content, got %v %v", err, rangeResp.StatusCode)
	}
	partBytes, _ := io.ReadAll(rangeResp.Body)
	_ = rangeResp.Body.Close()
	if string(partBytes) != "Serevox" {
		t.Fatalf("expected range body 'Serevox', got %q", string(partBytes))
	}

	// 4. REST: Upload PNG to public bucket and test on-the-fly image resize + format conversion
	pngBytes := makeSamplePNG(200, 120)
	upReq, _ := http.NewRequest("POST", srv.URL+"/v1/buckets/serevox-public/objects/upload?path=banners/hero.png&upsert=true", bytes.NewReader(pngBytes))
	upReq.Header.Set("Authorization", "Bearer "+serviceKey)
	upReq.Header.Set("Content-Type", "image/png")
	upResp, err := http.DefaultClient.Do(upReq)
	if err != nil || upResp.StatusCode != 200 {
		t.Fatalf("public png upload failed: %v %d", err, upResp.StatusCode)
	}
	_ = upResp.Body.Close()

	imgResp, err := http.Get(srv.URL + "/v1/public/serevox-public/banners/hero.png?w=80&h=80&format=jpeg&q=85")
	if err != nil || imgResp.StatusCode != 200 {
		t.Fatalf("image transform failed: %v %d", err, imgResp.StatusCode)
	}
	ct := imgResp.Header.Get("Content-Type")
	_, _ = io.ReadAll(imgResp.Body)
	_ = imgResp.Body.Close()
	if ct != "image/jpeg" {
		t.Fatalf("expected transformed image/jpeg, got %s", ct)
	}

	// 5. S3 SigV4: PutObject, ListObjectsV2, Multipart Upload, DeleteObject
	s3Payload := []byte("hello-from-s3-sigv4")
	s3Sum := sha256.Sum256(s3Payload)
	s3PutReq, _ := http.NewRequest("PUT", srv.URL+"/s3/serevox-public/sdk/test.txt", bytes.NewReader(s3Payload))
	signS3Request(s3PutReq, s3AK, s3SK, "us-east-1", hex.EncodeToString(s3Sum[:]))
	s3PutResp, err := http.DefaultClient.Do(s3PutReq)
	if err != nil || s3PutResp.StatusCode != 200 {
		b, _ := io.ReadAll(s3PutResp.Body)
		t.Fatalf("S3 PutObject failed: %v status=%d body=%s", err, s3PutResp.StatusCode, string(b))
	}
	_ = s3PutResp.Body.Close()

	// S3 ListObjectsV2
	emptySum := sha256.Sum256(nil)
	emptyHex := hex.EncodeToString(emptySum[:])
	listReq, _ := http.NewRequest("GET", srv.URL+"/s3/serevox-public?list-type=2&prefix=sdk/", nil)
	signS3Request(listReq, s3AK, s3SK, "us-east-1", emptyHex)
	listResp, err := http.DefaultClient.Do(listReq)
	if err != nil || listResp.StatusCode != 200 {
		t.Fatalf("S3 ListObjectsV2 failed: %v %d", err, listResp.StatusCode)
	}
	listBody, _ := io.ReadAll(listResp.Body)
	_ = listResp.Body.Close()
	if !strings.Contains(string(listBody), "<Key>sdk/test.txt</Key>") {
		t.Fatalf("expected sdk/test.txt in S3 ListObjectsV2 XML, got %s", string(listBody))
	}

	// S3 Multipart Upload flow
	initReq, _ := http.NewRequest("POST", srv.URL+"/s3/serevox-public/videos/clip.bin?uploads", nil)
	signS3Request(initReq, s3AK, s3SK, "us-east-1", emptyHex)
	initResp, err := http.DefaultClient.Do(initReq)
	if err != nil || initResp.StatusCode != 200 {
		t.Fatalf("CreateMultipartUpload failed: %v %d", err, initResp.StatusCode)
	}
	var initXML struct {
		UploadID string `xml:"UploadId"`
	}
	initBytes, _ := io.ReadAll(initResp.Body)
	_ = initResp.Body.Close()
	if err := xml.Unmarshal(initBytes, &initXML); err != nil || initXML.UploadID == "" {
		t.Fatalf("failed to parse UploadId: %s", string(initBytes))
	}

	part1 := []byte("PART-ONE-")
	part2 := []byte("PART-TWO")
	for idx, p := range [][]byte{part1, part2} {
		ps := sha256.Sum256(p)
		u := fmt.Sprintf("%s/s3/serevox-public/videos/clip.bin?partNumber=%d&uploadId=%s", srv.URL, idx+1, url.QueryEscape(initXML.UploadID))
		pr, _ := http.NewRequest("PUT", u, bytes.NewReader(p))
		signS3Request(pr, s3AK, s3SK, "us-east-1", hex.EncodeToString(ps[:]))
		presp, err := http.DefaultClient.Do(pr)
		if err != nil || presp.StatusCode != 200 {
			t.Fatalf("UploadPart %d failed: %v %d", idx+1, err, presp.StatusCode)
		}
		_ = presp.Body.Close()
	}

	compURL := fmt.Sprintf("%s/s3/serevox-public/videos/clip.bin?uploadId=%s", srv.URL, url.QueryEscape(initXML.UploadID))
	compReq, _ := http.NewRequest("POST", compURL, strings.NewReader("<CompleteMultipartUpload></CompleteMultipartUpload>"))
	compSum := sha256.Sum256([]byte("<CompleteMultipartUpload></CompleteMultipartUpload>"))
	signS3Request(compReq, s3AK, s3SK, "us-east-1", hex.EncodeToString(compSum[:]))
	compResp, err := http.DefaultClient.Do(compReq)
	if err != nil || compResp.StatusCode != 200 {
		t.Fatalf("CompleteMultipartUpload failed: %v %d", err, compResp.StatusCode)
	}
	_ = compResp.Body.Close()

	dlClip, err := http.Get(srv.URL + "/v1/public/serevox-public/videos/clip.bin")
	if err != nil || dlClip.StatusCode != 200 {
		t.Fatalf("download assembled multipart failed: %v %d", err, dlClip.StatusCode)
	}
	clipBytes, _ := io.ReadAll(dlClip.Body)
	_ = dlClip.Body.Close()
	if string(clipBytes) != "PART-ONE-PART-TWO" {
		t.Fatalf("expected 'PART-ONE-PART-TWO', got %q", string(clipBytes))
	}

	// 6. Webhook HMAC delivery test
	received := make(chan string, 1)
	whSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- r.Header.Get("X-Serevox-Signature")
		w.WriteHeader(200)
	}))
	defer whSrv.Close()

	resp, whRes := doJSON(t, "POST", srv.URL+"/console/api/projects/"+projID+"/webhooks", consoleTok, map[string]any{
		"url":    whSrv.URL,
		"events": []string{"object.uploaded"},
	})
	if resp.StatusCode != 201 {
		t.Fatalf("create webhook failed: %d %v", resp.StatusCode, whRes)
	}
	whID := whRes["webhook"].(map[string]any)["id"].(string)
	resp, testDel := doJSON(t, "POST", fmt.Sprintf("%s/console/api/projects/%s/webhooks/%s/test", srv.URL, projID, whID), consoleTok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("test webhook failed: %d %v", resp.StatusCode, testDel)
	}
	select {
	case sig := <-received:
		if !strings.HasPrefix(sig, "sha256=") {
			t.Fatalf("expected sha256= webhook signature, got %s", sig)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for webhook test delivery")
	}

	// 7. S3 Presigned GET URL + CopyObject + HeadObject + Batch DeleteObjects
	presignedURL := buildPresignedS3URL(srv.URL, "/serevox-public/sdk/test.txt", "GET", s3AK, s3SK, "us-east-1", 300)
	preResp, err := http.Get(presignedURL)
	if err != nil || preResp.StatusCode != 200 {
		t.Fatalf("S3 presigned GET failed: %v status=%d", err, preResp.StatusCode)
	}
	preBody, _ := io.ReadAll(preResp.Body)
	_ = preResp.Body.Close()
	if string(preBody) != "hello-from-s3-sigv4" {
		t.Fatalf("unexpected presigned S3 body: %q", string(preBody))
	}

	// CopyObject
	copyReq, _ := http.NewRequest("PUT", srv.URL+"/s3/serevox-public/sdk/copied.txt", nil)
	copyReq.Header.Set("X-Amz-Copy-Source", "/serevox-public/sdk/test.txt")
	signS3Request(copyReq, s3AK, s3SK, "us-east-1", emptyHex)
	copyResp, err := http.DefaultClient.Do(copyReq)
	if err != nil || copyResp.StatusCode != 200 {
		t.Fatalf("S3 CopyObject failed: %v %d", err, copyResp.StatusCode)
	}
	_ = copyResp.Body.Close()

	// HeadObject on copied object
	headReq, _ := http.NewRequest("HEAD", srv.URL+"/s3/serevox-public/sdk/copied.txt", nil)
	signS3Request(headReq, s3AK, s3SK, "us-east-1", emptyHex)
	headResp, err := http.DefaultClient.Do(headReq)
	if err != nil || headResp.StatusCode != 200 {
		t.Fatalf("S3 HeadObject failed: %v %d", err, headResp.StatusCode)
	}
	_ = headResp.Body.Close()

	// Batch DeleteObjects
	delXML := `<Delete><Object><Key>sdk/test.txt</Key></Object><Object><Key>sdk/copied.txt</Key></Object></Delete>`
	delSum := sha256.Sum256([]byte(delXML))
	delReq, _ := http.NewRequest("POST", srv.URL+"/s3/serevox-public?delete", strings.NewReader(delXML))
	signS3Request(delReq, s3AK, s3SK, "us-east-1", hex.EncodeToString(delSum[:]))
	delResp, err := http.DefaultClient.Do(delReq)
	if err != nil || delResp.StatusCode != 200 {
		t.Fatalf("S3 DeleteObjects failed: %v %d", err, delResp.StatusCode)
	}
	_ = delResp.Body.Close()

	// 8. MIME whitelist enforcement on private-docs (only allows text/plain and image/*)
	badReq, _ := http.NewRequest("POST", srv.URL+"/v1/buckets/private-docs/objects/upload?path=bad.pdf", strings.NewReader("%PDF-1.7 fake"))
	badReq.Header.Set("Authorization", "Bearer "+serviceKey)
	badReq.Header.Set("Content-Type", "application/pdf")
	badResp, err := http.DefaultClient.Do(badReq)
	if err != nil || badResp.StatusCode != 415 {
		t.Fatalf("expected 415 Unsupported Media Type for disallowed MIME, got %v %d", err, badResp.StatusCode)
	}
	_ = badResp.Body.Close()

	// 9. Metrics endpoint clean JSON + Self-service user registration + tenant isolation
	resp, mRes := doJSON(t, "GET", srv.URL+"/console/api/projects/"+projID+"/metrics", consoleTok, nil)
	if resp.StatusCode != 200 || mRes["metrics"] == nil {
		t.Fatalf("metrics failed: %d %v", resp.StatusCode, mRes)
	}

	resp, regRes := doJSON(t, "POST", srv.URL+"/console/api/auth/register", "", map[string]any{
		"email":        "tenant2@serevox.dev",
		"name":         "Second Tenant",
		"password":     "second-secret",
		"project_name": "tenant2-app",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("register failed: %d %v", resp.StatusCode, regRes)
	}
	regTok := regRes["token"].(string)

	// Tenant 2 must NOT be able to access Tenant 1's project metrics
	resp, _ = doJSON(t, "GET", srv.URL+"/console/api/projects/"+projID+"/metrics", regTok, nil)
	if resp.StatusCode != 404 {
		t.Fatalf("expected 404 for cross-tenant project access, got %d", resp.StatusCode)
	}

	// 10. Admin Access RBAC & Platform Management
	resp, _ = doJSON(t, "GET", srv.URL+"/console/api/admin/overview", regTok, nil)
	if resp.StatusCode != 403 {
		t.Fatalf("expected 403 for member accessing admin overview, got %d", resp.StatusCode)
	}

	resp, adminOv := doJSON(t, "GET", srv.URL+"/console/api/admin/overview", consoleTok, nil)
	if resp.StatusCode != 200 || adminOv["stats"] == nil || adminOv["users"] == nil || adminOv["buckets"] == nil {
		t.Fatalf("admin overview failed: %d %v", resp.StatusCode, adminOv)
	}

	resp, createdUserRes := doJSON(t, "POST", srv.URL+"/console/api/admin/users", consoleTok, map[string]any{
		"email":        "ops@serevox.dev",
		"name":         "Ops Engineer",
		"password":     "ops-secret",
		"project_name": "ops-storage",
		"role":         "member",
	})
	if resp.StatusCode != 201 {
		t.Fatalf("admin create user failed: %d %v", resp.StatusCode, createdUserRes)
	}
	opsUserID := createdUserRes["user"].(map[string]any)["id"].(string)

	resp, roleRes := doJSON(t, "PATCH", srv.URL+"/console/api/admin/users/"+opsUserID+"/role", consoleTok, map[string]any{
		"role": "admin",
	})
	if resp.StatusCode != 200 || roleRes["role"] != "admin" {
		t.Fatalf("admin update role failed: %d %v", resp.StatusCode, roleRes)
	}

	resp, _ = doJSON(t, "DELETE", srv.URL+"/console/api/admin/users/"+opsUserID, consoleTok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin delete user failed: %d", resp.StatusCode)
	}

	// 11. User rename project & bucket + Admin control over other user's project & bucket
	t2ProjID := regRes["project"].(map[string]any)["id"].(string)
	resp, t2BucketsRes := doJSON(t, "GET", srv.URL+"/console/api/projects/"+t2ProjID+"/buckets", regTok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("list tenant2 buckets failed: %d", resp.StatusCode)
	}
	t2BucketID := t2BucketsRes["buckets"].([]any)[0].(map[string]any)["id"].(string)

	// User renames own project & bucket
	resp, renProjRes := doJSON(t, "PATCH", srv.URL+"/console/api/projects/"+t2ProjID, regTok, map[string]any{
		"name": "tenant2-renamed-app",
	})
	if resp.StatusCode != 200 || renProjRes["project"].(map[string]any)["name"] != "tenant2-renamed-app" {
		t.Fatalf("user rename project failed: %d %v", resp.StatusCode, renProjRes)
	}
	resp, renBucketRes := doJSON(t, "PATCH", srv.URL+"/console/api/buckets/"+t2BucketID, regTok, map[string]any{
		"name": "tenant2-renamed-bucket",
	})
	if resp.StatusCode != 200 || renBucketRes["bucket"].(map[string]any)["name"] != "tenant2-renamed-bucket" {
		t.Fatalf("user rename bucket failed: %d %v", resp.StatusCode, renBucketRes)
	}

	// Admin renames & toggles visibility on Tenant 2's bucket and project, then deletes them
	resp, admBucketRes := doJSON(t, "PATCH", srv.URL+"/console/api/admin/buckets/"+t2BucketID, consoleTok, map[string]any{
		"name":       "admin-managed-bucket",
		"visibility": "private",
	})
	if resp.StatusCode != 200 || admBucketRes["bucket"].(map[string]any)["name"] != "admin-managed-bucket" {
		t.Fatalf("admin update other user bucket failed: %d %v", resp.StatusCode, admBucketRes)
	}
	resp, admProjRes := doJSON(t, "PATCH", srv.URL+"/console/api/admin/projects/"+t2ProjID, consoleTok, map[string]any{
		"name": "admin-managed-project",
	})
	if resp.StatusCode != 200 || admProjRes["project"].(map[string]any)["name"] != "admin-managed-project" {
		t.Fatalf("admin update other user project failed: %d %v", resp.StatusCode, admProjRes)
	}
	resp, _ = doJSON(t, "DELETE", srv.URL+"/console/api/admin/buckets/"+t2BucketID, consoleTok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin delete other user bucket failed: %d", resp.StatusCode)
	}
	resp, _ = doJSON(t, "DELETE", srv.URL+"/console/api/admin/projects/"+t2ProjID, consoleTok, nil)
	if resp.StatusCode != 200 {
		t.Fatalf("admin delete other user project failed: %d", resp.StatusCode)
	}
}

func buildPresignedS3URL(baseURL, path, method, ak, sk, region string, expires int) string {
	u, _ := url.Parse(baseURL)
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	scope := fmt.Sprintf("%s/%s/s3/aws4_request", dateStamp, region)

	q := url.Values{}
	q.Set("X-Amz-Algorithm", "AWS4-HMAC-SHA256")
	q.Set("X-Amz-Credential", ak+"/"+scope)
	q.Set("X-Amz-Date", amzDate)
	q.Set("X-Amz-Expires", fmt.Sprintf("%d", expires))
	q.Set("X-Amz-SignedHeaders", "host")

	canonicalQuery := q.Encode()
	canonicalHeaders := fmt.Sprintf("host:%s\n", u.Host)
	canonicalReq := strings.Join([]string{
		method,
		path,
		canonicalQuery,
		canonicalHeaders,
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	crHash := sha256.Sum256([]byte(canonicalReq))
	strToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		hex.EncodeToString(crHash[:]),
	}, "\n")

	hmacFn := func(key, data []byte) []byte {
		m := hmac.New(sha256.New, key)
		m.Write(data)
		return m.Sum(nil)
	}
	kDate := hmacFn([]byte("AWS4"+sk), []byte(dateStamp))
	kRegion := hmacFn(kDate, []byte(region))
	kService := hmacFn(kRegion, []byte("s3"))
	kSigning := hmacFn(kService, []byte("aws4_request"))
	sig := hex.EncodeToString(hmacFn(kSigning, []byte(strToSign)))
	q.Set("X-Amz-Signature", sig)
	return baseURL + path + "?" + q.Encode()
}

