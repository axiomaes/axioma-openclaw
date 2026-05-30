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

# Instalamos de forma local en /app para evitar problemas de PATH y binarios globales
RUN npm init -y && npm install openclaw pg puppeteer imapflow nodemailer

# Seteamos NODE_PATH para que los scripts en /root/.openclaw/workspace encuentren los módulos
ENV NODE_PATH=/app/node_modules

# Seteamos la variable para que Puppeteer use el Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

# Llamamos al binario local directamente, infalible.
CMD ["./node_modules/.bin/openclaw", "start"]
