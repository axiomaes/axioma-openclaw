#!/bin/sh
set -e

# Si no existe auth configurada, ejecuta onboard con Groq
if [ ! -f /root/.openclaw/openclaw.json ]; then
  echo "[entrypoint] Configuring Groq auth..."
  openclaw onboard --non-interactive \
    --accept-risk \
    --mode local \
    --auth-choice groq-api-key \
    --token "${GROQ_API_KEY}" \
    --token-provider groq \
    --skip-channels \
    --skip-daemon \
    --skip-skills
fi

# Crea el directorio si no existe y copia auth profiles al directorio del agente
mkdir -p /root/.openclaw/agents/main/agent
cp /root/.openclaw/workspace/agent-auth-profiles.json /root/.openclaw/agents/main/agent/auth-profiles.json

# Configura el modelo del agente main
cat > /root/.openclaw/agents/main/agent/settings.json << 'SETTINGS'
{
  "model": {
    "primary": "groq/llama-3.1-8b-instant"
  }
}
SETTINGS

# Arranca OpenClaw
exec openclaw "$@"
