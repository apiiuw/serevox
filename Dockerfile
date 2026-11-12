# Stage 1: Build Web Console
FROM node:24-alpine AS web-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: Build Go Backend
FROM golang:1.27-alpine AS go-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /serevox ./cmd/serevox

# Stage 3: Minimal Runtime
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget curl net-tools iputils bind-tools netcat-openbsd
WORKDIR /app
COPY --from=go-builder /serevox /app/serevox
COPY --from=web-builder /app/web/dist /app/web/dist
RUN mkdir -p /data /app/uploads

ENV SEREVOX_PORT=80
ENV SEREVOX_DATA_DIR=/data
ENV SEREVOX_STATIC_DIR=/app/web/dist

VOLUME ["/data"]
EXPOSE 80

ENTRYPOINT ["/app/serevox"]
