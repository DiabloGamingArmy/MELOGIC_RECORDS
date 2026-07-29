FROM bluenviron/mediamtx:1.18.2 AS mediamtx

FROM alpine:3.21
RUN apk add --no-cache ca-certificates ffmpeg
COPY --from=mediamtx /mediamtx /mediamtx
ENTRYPOINT ["/mediamtx"]
