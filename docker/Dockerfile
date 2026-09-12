# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
ARG VERSION=dev
ENV MAZECD_VERSION=${VERSION}
# Vite writes to ../internal/web/dist, i.e. /src/internal/web/dist
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY --from=web /src/internal/web/dist ./internal/web/dist
ARG VERSION=dev
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH} go build -trimpath \
      -ldflags "-s -w -X main.version=${VERSION}" -o /out/mazecd ./cmd/mazecd

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/mazecd /mazecd
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/mazecd"]
CMD ["serve"]
