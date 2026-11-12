package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
)

type ConsoleClaims struct {
	UserID string `json:"uid"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

type SignedObjectClaims struct {
	BucketID   string `json:"bid"`
	BucketName string `json:"bkt"`
	ObjectKey  string `json:"key"`
	Operation  string `json:"op"` // "download" or "upload"
	Upsert     bool   `json:"upsert,omitempty"`
	jwt.RegisteredClaims
}

type Service struct {
	masterKey []byte
}

func NewService(masterKey []byte) *Service {
	k := make([]byte, 32)
	copy(k, masterKey)
	return &Service{masterKey: k}
}

func (s *Service) HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func (s *Service) VerifyPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func (s *Service) IssueConsoleToken(userID, email, role string) (string, error) {
	now := time.Now().UTC()
	claims := ConsoleClaims{
		UserID: userID,
		Email:  email,
		Role:   role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "serevox",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(s.masterKey)
}

func (s *Service) VerifyConsoleToken(tokenStr string) (*ConsoleClaims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &ConsoleClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrUnauthorized
		}
		return s.masterKey, nil
	})
	if err != nil || !tok.Valid {
		return nil, ErrUnauthorized
	}
	claims, ok := tok.Claims.(*ConsoleClaims)
	if !ok {
		return nil, ErrUnauthorized
	}
	return claims, nil
}

func (s *Service) IssueSignedObjectToken(bucketID, bucketName, key, op string, upsert bool, ttl time.Duration) (string, error) {
	if ttl <= 0 {
		ttl = 15 * time.Minute
	}
	now := time.Now().UTC()
	claims := SignedObjectClaims{
		BucketID:   bucketID,
		BucketName: bucketName,
		ObjectKey:  key,
		Operation:  op,
		Upsert:     upsert,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "serevox-signed",
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return tok.SignedString(s.masterKey)
}

func (s *Service) VerifySignedObjectToken(tokenStr string) (*SignedObjectClaims, error) {
	tok, err := jwt.ParseWithClaims(tokenStr, &SignedObjectClaims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrUnauthorized
		}
		return s.masterKey, nil
	})
	if err != nil || !tok.Valid {
		return nil, ErrUnauthorized
	}
	claims, ok := tok.Claims.(*SignedObjectClaims)
	if !ok {
		return nil, ErrUnauthorized
	}
	return claims, nil
}

func (s *Service) EncryptSecret(plaintext string) (string, error) {
	block, err := aes.NewCipher(s.masterKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

func (s *Service) DecryptSecret(ciphertextB64 string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(ciphertextB64)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(s.masterKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce := raw[:gcm.NonceSize()]
	ct := raw[gcm.NonceSize():]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(pt), nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func GenerateRESTKey(keyType string) (plain string, prefix string, hash string, err error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", "", "", err
	}
	tag := "srv"
	if keyType == "anon" {
		tag = "anon"
	}
	plain = fmt.Sprintf("srx_%s_%s", tag, hex.EncodeToString(raw))
	prefix = plain[:16] + "..."
	return plain, prefix, HashToken(plain), nil
}

func GenerateS3KeyPair() (accessKeyID, secretAccessKey string, err error) {
	akRaw := make([]byte, 10)
	skRaw := make([]byte, 20)
	if _, err := rand.Read(akRaw); err != nil {
		return "", "", err
	}
	if _, err := rand.Read(skRaw); err != nil {
		return "", "", err
	}
	accessKeyID = "SRX" + strings.ToUpper(hex.EncodeToString(akRaw))
	secretAccessKey = base64.RawURLEncoding.EncodeToString(skRaw) + "Srx"
	return accessKeyID, secretAccessKey, nil
}

