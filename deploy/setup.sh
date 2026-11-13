#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu/Debian VM (run as root): Docker, firewall, fail2ban,
# unattended security updates. Safe to run again.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo bash setup.sh" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl ufw fail2ban unattended-upgrades

# Docker (official convenience script; includes the compose plugin)
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Let the login user run docker without sudo (takes effect after a new SSH login).
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  usermod -aG docker "$SUDO_USER"
fi

# Firewall: SSH + HTTP + HTTPS only
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Done. Log out and in again (docker group), then:"
echo "  cd deploy && cp .env.example .env && nano .env && ./deploy.sh"
