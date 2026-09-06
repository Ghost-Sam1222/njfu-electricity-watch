#!/usr/bin/env bash
set -euo pipefail

work_dir="${RUNNER_TEMP:-/tmp}/mihomo"
config_file="$work_dir/config.yaml"
binary_file="$work_dir/mihomo"

mkdir -p "$work_dir"

download_subscription() {
  local url="$1"
  curl -fsSL \
    -A "ClashforWindows/0.20.39" \
    -H "Accept: text/yaml,application/yaml,text/plain,*/*" \
    "$url" \
    -o "$config_file"
}

if [[ -n "${CLASH_CONFIG_YAML:-}" ]]; then
  echo "Using Clash config from GitHub Secret..."
  printf '%s\n' "$CLASH_CONFIG_YAML" > "$config_file"
elif [[ -n "${CLASH_SUBSCRIPTION_URL:-}" ]]; then
  echo "Downloading Clash subscription..."
  if ! download_subscription "$CLASH_SUBSCRIPTION_URL"; then
    echo "Primary subscription URL failed; trying embedded provider URL..."
    embedded_url="$(
      SUBSCRIPTION_URL="$CLASH_SUBSCRIPTION_URL" node -e '
        const url = new URL(process.env.SUBSCRIPTION_URL);
        console.log(url.searchParams.get("url") || "");
      '
    )"
    if [[ -z "$embedded_url" ]] || ! download_subscription "$embedded_url"; then
      echo "Unable to download Clash subscription."
      exit 1
    fi
  fi
else
  echo "No Clash config or subscription is configured; skip Mihomo proxy."
  exit 0
fi

if ! grep -Eq '^(proxies|proxy-providers|proxy-groups|mixed-port|port|socks-port):' "$config_file"; then
  echo "Downloaded subscription does not look like a Clash YAML config."
  exit 1
fi

tmp_config="$work_dir/config.normalized.yaml"
awk '!/^(mixed-port|allow-lan|bind-address|mode|log-level|external-controller|secret):/' "$config_file" > "$tmp_config"
cat >> "$tmp_config" <<'YAML'

mixed-port: 7890
allow-lan: false
bind-address: 127.0.0.1
mode: global
log-level: warning
external-controller: 127.0.0.1:9091
secret: ""
YAML
mv "$tmp_config" "$config_file"

echo "Downloading Mihomo core..."
asset_url="$(
  curl -fsSL https://api.github.com/repos/MetaCubeX/mihomo/releases/latest |
  node -e '
    const fs = require("node:fs");
    const release = JSON.parse(fs.readFileSync(0, "utf8"));
    const assets = release.assets || [];
    const preferred = assets.find(asset => /mihomo-linux-amd64-v1-.*\.gz$/.test(asset.name))
      || assets.find(asset => /mihomo-linux-amd64-compatible-.*\.gz$/.test(asset.name))
      || assets.find(asset => /mihomo-linux-amd64.*\.gz$/.test(asset.name));
    if (!preferred) {
      console.error("No linux amd64 Mihomo asset found.");
      process.exit(1);
    }
    console.log(preferred.browser_download_url);
  '
)"

curl -fsSL "$asset_url" -o "$work_dir/mihomo.gz"
gzip -dc "$work_dir/mihomo.gz" > "$binary_file"
chmod +x "$binary_file"

echo "Starting Mihomo local proxy..."
"$binary_file" -f "$config_file" -d "$work_dir" > "$work_dir/mihomo.log" 2>&1 &
echo "$!" > "$work_dir/mihomo.pid"

for _ in $(seq 1 30); do
  if curl -fsS --proxy http://127.0.0.1:7890 --connect-timeout 8 https://icard.njfu.edu.cn/charge-app/ -o /dev/null; then
    echo "Mihomo proxy is ready."
    echo "proxy=http://127.0.0.1:7890" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  sleep 1
done

echo "Mihomo proxy did not become ready in time."
tail -n 80 "$work_dir/mihomo.log" || true
exit 1
