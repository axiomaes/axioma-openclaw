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

# Arranca OpenClaw
exec openclaw "$@"
