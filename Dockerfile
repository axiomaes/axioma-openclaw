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

# Configuramos el gateway en modo local (sin cuenta cloud de openclaw)
RUN openclaw config set gateway.mode local && \
    openclaw config set gateway.bind lan

# Copiamos el workspace al destino que openclaw espera por defecto
# Los volúmenes de compose/Coolify pueden sobreescribir esto en runtime
COPY workspace /root/.openclaw/workspace

WORKDIR /app

EXPOSE 3000

# "gateway run" mantiene el proceso en foreground (para Docker)
# "--allow-unconfigured" permite arrancar sin configuración cloud adicional
CMD ["openclaw", "gateway", "run", "--allow-unconfigured"]
