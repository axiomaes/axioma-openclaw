FROM node:22-alpine3.21

# Instalamos dependencias del sistema para el navegador headless (Scraping)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Seteamos variables de entorno para Puppeteer y las dependencias globales de Node
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_PATH=/usr/local/lib/node_modules
ENV OPENCLAW_HEADLESS=true

# Instalamos todo GLOBALMENTE para evitar conflictos con montajes de volúmenes de Coolify en /app
RUN npm install -g openclaw pg puppeteer imapflow nodemailer

# Modo local (self-hosted, sin cuenta cloud) + loopback (Docker maneja el port mapping)
# El token de auth se inyecta en runtime via OPENCLAW_GATEWAY_TOKEN (configurar en Coolify)
RUN openclaw config set gateway.mode local && \
    openclaw config set gateway.bind loopback

# Copiamos el workspace al destino que openclaw espera por defecto
# Los volúmenes de compose/Coolify pueden sobreescribir esto en runtime
COPY workspace /root/.openclaw/workspace
COPY workspace/settings.json /root/.openclaw/settings.json

WORKDIR /app

EXPOSE 3000

# "gateway run" mantiene el proceso en foreground (para Docker)
# "--allow-unconfigured" permite arrancar sin configuración cloud adicional
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["gateway", "run", "--allow-unconfigured"]
