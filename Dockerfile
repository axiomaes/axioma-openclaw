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

# Inicializamos un package.json limpio e instalamos todo LOCALMENTE en /app
RUN npm init -y && \
    npm install openclaw pg puppeteer imapflow nodemailer

# Seteamos variables de entorno para Puppeteer y las dependencias de Node
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_PATH=/app/node_modules

EXPOSE 3000

# Apuntamos al ejecutable local que se acaba de crear con total seguridad
CMD ["./node_modules/.bin/openclaw", "start"]
