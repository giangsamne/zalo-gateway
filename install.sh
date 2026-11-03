#!/usr/bin/env bash
# Zalo Gateway 1-Line Universal Installer (Linux)
# Author: Giang3DLab / Giang Sam (@giangsamne)
set -e

APP="zalo-gateway"
REPO="giangsamne/zalo-gateway"
INSTALL_DIR="/usr/local/bin"

echo "=========================================================="
echo "   ⚡ Zalo Gateway - Universal Installer                  "
echo "=========================================================="

if command -v go >/dev/null 2>&1; then
  echo "🔨 Compiling from source with Go..."
  go build -ldflags="-s -w" -o "$APP" .
  
  if [ -w "$INSTALL_DIR" ]; then
    cp "$APP" "$INSTALL_DIR/$APP"
  else
    echo "🔒 Sudo required to install to $INSTALL_DIR/$APP"
    sudo cp "$APP" "$INSTALL_DIR/$APP"
  fi
  echo "✅ Installed $APP to $INSTALL_DIR/$APP"
else
  echo "❌ Go compiler is required to build Zalo Gateway."
  exit 1
fi

# Systemd autostart setup for Linux
if command -v systemctl >/dev/null 2>&1; then
  read -p "❓ Do you want to enable and start Zalo Gateway as a systemd service? (Y/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]] || [ -z "$REPLY" ]; then
    CURRENT_USER="$USER"
    SERVICE_FILE="/etc/systemd/system/${APP}.service"
    sudo bash -c "cat <<EOF > $SERVICE_FILE
[Unit]
Description=Zalo Gateway - Multi-Session Web & Automation Hub
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$HOME
ExecStart=$INSTALL_DIR/$APP -port 54321
Restart=always
RestartSec=3
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=HOME=$HOME

[Install]
WantedBy=multi-user.target
EOF"
    sudo systemctl daemon-reload
    sudo systemctl enable --now "${APP}.service"
    echo "🚀 Zalo Gateway service started on port 54321!"
  fi
fi

echo "=========================================================="
echo " 🎉 Installation Complete!                                "
echo " 🌐 Web Dashboard: http://localhost:54321                 "
echo " 📖 Agent Guide:   http://localhost:54321/agent-guide.md  "
echo "=========================================================="
