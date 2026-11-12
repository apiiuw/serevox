package webhook

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/serevox/serevox/internal/db"
)

type Dispatcher struct {
	store  *db.Store
	client *http.Client
	queue  chan dispatchJob
}

type dispatchJob struct {
	webhook   db.Webhook
	eventType string
	payload   []byte
}

func NewDispatcher(store *db.Store) *Dispatcher {
	d := &Dispatcher{
		store: store,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		queue: make(chan dispatchJob, 256),
	}
	for i := 0; i < 3; i++ {
		go d.worker()
	}
	return d
}

// ValidateWebhookURL checks URL scheme and blocks cloud metadata / link-local endpoints.
func ValidateWebhookURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("webhook URL must use http or https")
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("webhook URL missing host")
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLinkLocalUnicast() {
		return fmt.Errorf("link-local metadata addresses are not allowed")
	}
	return nil
}

// Emit enqueues webhook deliveries for all active project webhooks subscribed to eventType.
func (d *Dispatcher) Emit(projectID, eventType string, data map[string]any) {
	hooks, err := d.store.ListActiveWebhooksByProjectAndEvent(projectID, eventType)
	if err != nil || len(hooks) == 0 {
		return
	}

	envelope := map[string]any{
		"id":         uuid.NewString(),
		"event":      eventType,
		"project_id": projectID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"data":       data,
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		return
	}

	for _, w := range hooks {
		select {
		case d.queue <- dispatchJob{webhook: w, eventType: eventType, payload: body}:
		default:
			// Drop if queue saturated rather than blocking storage I/O path.
		}
	}
}

// DeliverSync sends a single webhook delivery immediately (used for "Test Webhook" in console).
func (d *Dispatcher) DeliverSync(w db.Webhook, eventType string, data map[string]any) (*db.WebhookDelivery, error) {
	envelope := map[string]any{
		"id":         uuid.NewString(),
		"event":      eventType,
		"project_id": w.ProjectID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"data":       data,
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	del := d.sendAttempt(w, eventType, body, 1)
	_ = d.store.RecordWebhookDelivery(del)
	return del, nil
}

func (d *Dispatcher) worker() {
	backoffs := []time.Duration{0, 2 * time.Second, 8 * time.Second}
	for job := range d.queue {
		for attempt, wait := range backoffs {
			if wait > 0 {
				time.Sleep(wait)
			}
			del := d.sendAttempt(job.webhook, job.eventType, job.payload, attempt+1)
			_ = d.store.RecordWebhookDelivery(del)
			if del.Success {
				break
			}
		}
	}
}

func (d *Dispatcher) sendAttempt(w db.Webhook, eventType string, payload []byte, attempt int) *db.WebhookDelivery {
	del := &db.WebhookDelivery{
		ID:          uuid.NewString(),
		WebhookID:   w.ID,
		EventType:   eventType,
		PayloadJSON: string(payload),
		Attempt:     attempt,
		CreatedAt:   time.Now().UTC(),
	}

	ts := fmt.Sprintf("%d", time.Now().UTC().Unix())
	mac := hmac.New(sha256.New, []byte(w.Secret))
	_, _ = mac.Write([]byte(ts + "."))
	_, _ = mac.Write(payload)
	sig := hex.EncodeToString(mac.Sum(nil))

	req, err := http.NewRequest(http.MethodPost, w.URL, bytes.NewReader(payload))
	if err != nil {
		del.ErrorMessage = err.Error()
		return del
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Serevox-Webhook/1.0")
	req.Header.Set("X-Serevox-Event", eventType)
	req.Header.Set("X-Serevox-Timestamp", ts)
	req.Header.Set("X-Serevox-Signature", "sha256="+sig)

	resp, err := d.client.Do(req)
	if err != nil {
		del.ErrorMessage = err.Error()
		return del
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	del.StatusCode = resp.StatusCode
	del.ResponseBody = string(respBytes)
	del.Success = resp.StatusCode >= 200 && resp.StatusCode < 300
	if !del.Success {
		del.ErrorMessage = fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return del
}

