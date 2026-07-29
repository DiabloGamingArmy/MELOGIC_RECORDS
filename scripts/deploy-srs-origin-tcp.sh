#!/usr/bin/env sh

# Recreate the Melogic SRS origin with browser WebRTC media forced over TCP.
# The WHIP signaling endpoint remains HTTPS through nginx, OBS keeps using
# RTMP/1935, and HLS remains available on 8080 for the Hetzner edge.
#
# Run on the GCE origin after TCP/8000 is allowed by the VPC firewall.

set -eu

origin_name="srs-origin"
backup_name="srs-origin-backup-$(date -u +%Y%m%dT%H%M%SZ)"
image_name="ossrs/srs:6"
candidate_ip="104.197.179.248"
health_url="http://127.0.0.1:1985/api/v1/versions"
streams_url="http://127.0.0.1:1985/api/v1/streams/"

if ! docker inspect "$origin_name" >/dev/null 2>&1; then
  echo "Expected container $origin_name was not found." >&2
  exit 1
fi

streams_json="$(curl -fsS "$streams_url")"
case "$streams_json" in
  *'"streams":[]'*) ;;
  *)
    echo "An SRS stream is active; refusing to interrupt a broadcast." >&2
    exit 1
    ;;
esac

backup_file="/var/tmp/srs-origin-before-tcp-$(date -u +%Y%m%dT%H%M%SZ).json"
docker inspect "$origin_name" > "$backup_file"
echo "Saved the previous container definition to $backup_file"

rollback() {
  echo "New SRS origin did not become healthy; restoring the UDP-only container." >&2
  if docker inspect "$origin_name" >/dev/null 2>&1; then
    docker stop "$origin_name" >/dev/null 2>&1 || true
    docker rm "$origin_name" >/dev/null 2>&1 || true
  fi
  if docker inspect "$backup_name" >/dev/null 2>&1; then
    docker rename "$backup_name" "$origin_name"
    docker update --restart=unless-stopped "$origin_name" >/dev/null
    docker start "$origin_name" >/dev/null
  fi
}

docker stop "$origin_name" >/dev/null
docker rename "$origin_name" "$backup_name"
docker update --restart=no "$backup_name" >/dev/null
trap rollback HUP INT TERM EXIT

docker run -d \
  --name "$origin_name" \
  --restart unless-stopped \
  -p 1935:1935/tcp \
  -p 1985:1985/tcp \
  -p 8080:8080/tcp \
  -p 8000:8000/udp \
  -p 8000:8000/tcp \
  -e CANDIDATE="$candidate_ip" \
  -e SRS_RTC_SERVER_ENABLED=on \
  -e SRS_RTC_SERVER_LISTEN=8000 \
  -e SRS_RTC_SERVER_CANDIDATE="$candidate_ip" \
  -e SRS_RTC_SERVER_TCP_ENABLED=on \
  -e SRS_RTC_SERVER_TCP_LISTEN=8000 \
  -e SRS_RTC_SERVER_PROTOCOL=tcp \
  -e SRS_VHOST_RTC_ENABLED=on \
  -e SRS_VHOST_RTC_RTC_TO_RTMP=on \
  -e SRS_VHOST_RTC_AAC_BITRATE=192000 \
  -e SRS_VHOST_RTC_PLI_FOR_RTMP=2.0 \
  -e SRS_VHOST_RTC_INIT_RATE_FROM_SDP=on \
  -e SRS_VHOST_HLS_ENABLED=on \
  -e SRS_VHOST_HLS_HLS_FRAGMENT=4 \
  -e SRS_VHOST_HLS_HLS_WINDOW=30 \
  "$image_name" >/dev/null

healthy="false"
attempt=0
while [ "$attempt" -lt 20 ]; do
  if curl -fsS "$health_url" >/dev/null 2>&1; then
    healthy="true"
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$healthy" != "true" ]; then
  docker logs --tail 100 "$origin_name" >&2 || true
  exit 1
fi

tcp_binding="$(docker inspect "$origin_name" --format '{{(index (index .HostConfig.PortBindings "8000/tcp") 0).HostPort}}')"
if [ "$tcp_binding" != "8000" ]; then
  echo "SRS is healthy, but TCP/8000 is not published." >&2
  exit 1
fi

trap - HUP INT TERM EXIT
echo "SRS origin is healthy with WebRTC media forced over TCP/8000."
echo "Rollback container retained as $backup_name."
