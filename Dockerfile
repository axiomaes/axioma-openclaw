FROM node:20-alpine

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

# Instalamos todo GLOBALMENTE para evitar conflictos con montajes de volúmenes de Coolify en /app
RUN npm install -g openclaw pg puppeteer imapflow nodemailer

WORKDIR /app

EXPOSE 3000

# Ejecutamos openclaw usando el ejecutable global instalado en el PATH del sistema
CMD ["openclaw", "start"]
