FROM node:20-alpine

# Instalamos dependencias del sistema para el navegador headless (Scraping)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

WORKDIR /app

# Instalación global del motor de OpenClaw y dependencias para las skills
RUN npm install -g openclaw pg puppeteer imapflow nodemailer

# Seteamos NODE_PATH para que los scripts locales puedan usar los módulos globales
ENV NODE_PATH=/usr/local/lib/node_modules

# Seteamos la variable para que Puppeteer use el Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

# Formato Shell nativo: el sistema buscará 'openclaw' en el PATH global automáticamente
CMD openclaw start
