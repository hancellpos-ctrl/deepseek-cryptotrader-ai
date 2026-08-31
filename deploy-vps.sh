#!/usr/bin/env bash

# ========================================================
# Script de Despliegue Automatizado para VPS (Ubuntu/Debian)
# ========================================================

set -e

echo "🚀 Iniciando instalación y despliegue de DeepSeek CryptoTrader AI..."

# 1. Actualizar paquetes del sistema
sudo apt update -y && sudo apt upgrade -y

# 2. Instalar Node.js 20 LTS si no está instalado
if ! command -v node &> /dev/null; then
    echo "📦 Instalando Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 3. Instalar PM2 y Git si no están instalados
sudo apt install -y git build-essential
sudo npm install -g pm2

# 4. Instalar dependencias del proyecto
echo "📦 Instalando dependencias de Node.js..."
npm install --production

# 5. Configurar .env si no existe
if [ ! -f .env ]; then
    echo "⚙️ Creando archivo .env..."
    cp .env.example .env
fi

# 6. Iniciar o reiniciar la app con PM2
echo "⚡ Iniciando aplicación con PM2..."
pm2 start ecosystem.config.js || pm2 restart cryptotrader-ai

# 7. Guardar lista de procesos de PM2 para que inicie automáticamente al reiniciar el VPS
pm2 save
pm2 startup | tail -n 1 | sudo bash || true

echo "========================================================"
echo "✅ ¡Despliegue completado con éxito!"
echo "📡 La app está corriendo en el puerto 3000."
echo "🔗 Accede desde tu navegador en: http://TU_IP_DEL_VPS:3000"
echo "========================================================"
