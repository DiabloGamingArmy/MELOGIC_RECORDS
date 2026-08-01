#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_source="${script_dir}/mediamtx-direct-whip.yml"
unit_source="${script_dir}/mediamtx-direct-whip.service"
dockerfile_source="${script_dir}/mediamtx-ffmpeg.Dockerfile"

if [[ ! -f "${config_source}" || ! -f "${unit_source}" || ! -f "${dockerfile_source}" ]]; then
  echo "Direct WHIP deployment files are missing." >&2
  exit 1
fi

# This VM previously hosted a spare SRS origin. Refuse to replace it if it has
# unexpectedly acquired a publisher since the pre-deployment inspection.
active_streams="$(curl -fsS http://127.0.0.1:1985/api/v1/streams/ 2>/dev/null || true)"
if [[ "${active_streams}" == *'"streams":['* && "${active_streams}" != *'"streams":[]'* ]]; then
  echo "Refusing deployment: the standby SRS origin has an active publisher." >&2
  exit 1
fi

sudo docker build \
  --tag melogic/mediamtx-ffmpeg:1.18.2-aac2 \
  --file "${dockerfile_source}" \
  "${script_dir}"

sudo install -d -m 0755 /etc/melogic
sudo install -m 0644 "${config_source}" /etc/melogic/mediamtx-direct-whip.yml
sudo install -m 0644 "${unit_source}" /etc/systemd/system/melogic-mediamtx-direct-whip.service
sudo systemctl daemon-reload
sudo systemctl enable melogic-mediamtx-direct-whip.service

# Stop only the verified-idle spare origin; this releases enough memory for the
# direct MediaMTX process and its per-stream AAC conversion.
if sudo docker ps --format '{{.Names}}' | grep -qx 'srs-origin'; then
  sudo docker stop -t 10 srs-origin
fi

sudo systemctl restart melogic-mediamtx-direct-whip.service
echo "Direct browser WebRTC ingest is active."
