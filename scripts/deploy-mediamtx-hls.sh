#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_source="${script_dir}/mediamtx-srs-whep.yml"
unit_source="${script_dir}/mediamtx-hls.service"
dockerfile_source="${script_dir}/mediamtx-ffmpeg.Dockerfile"
restart_now="${1:-}"

if [[ ! -f "${config_source}" || ! -f "${unit_source}" || ! -f "${dockerfile_source}" ]]; then
  echo "MediaMTX deployment files are missing." >&2
  exit 1
fi

sudo docker build \
  --tag melogic/mediamtx-ffmpeg:1.18.2-aac1 \
  --file "${dockerfile_source}" \
  "${script_dir}"

sudo install -d -m 0755 /etc/melogic
sudo install -m 0644 "${config_source}" /etc/melogic/mediamtx-srs-whep.yml
sudo install -m 0644 "${unit_source}" /etc/systemd/system/melogic-mediamtx-hls.service
sudo systemctl daemon-reload
sudo systemctl enable melogic-mediamtx-hls.service

if [[ "${restart_now}" == "--restart" ]]; then
  sudo systemctl restart melogic-mediamtx-hls.service
  echo "Installed and restarted the Safari-compatible MediaMTX HLS service."
else
  echo "Installed durable MediaMTX configuration and enabled melogic-mediamtx-hls.service."
  echo "The currently running sidecar is left untouched; pass --restart to activate this build immediately."
fi
