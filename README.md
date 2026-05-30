# Axioma Creativa - OpenClaw Agent Network

Este repositorio contiene la infraestructura y el espacio de trabajo de la **Red de Agentes Autónomos** de **Axioma Creativa**, construida sobre el framework de automatización **OpenClaw** y desplegada mediante contenedores Docker (Alpine Linux).

El agente principal configurado es **Axio Scout**, cuyo rol es actuar como Consultor de Crecimiento y Automatización B2B, encargándose del triaje de correos entrantes, auditoría del sitio web/catálogo y estructuración de contenido para redes sociales.

---

## 🗺️ Panorama de la Arquitectura

```mermaid
graph TD
    subgraph Docker Container (Alpine)
        OC[OpenClaw Process] -->|Lee configuración| AG[AGENTS.md]
        OC -->|Bucle de eventos| HB[HEARTBEAT.md]
        OC -->|Carga de habilidades| SK[workspace/skills/*]
        SK -->|Triage de emails| MC[mailcow-triage]
        SK -->|Auditoría e Inteligencia| SW[scout-web]
        SK -->|Publicación Redes| SP[social-publish]
    end
    
    MC -->|IMAP/SMTP| MailServer[Servidor Mailcow]
    MC -->|API/Fetch| CFA[Cloudflare AI / Worker]
    SW -->|Puppeteer/Scrape| Web[Sitio Web Axioma]
    SW -->|pg Client| DB[(PostgreSQL Axioma Core)]
    SP -->|Graph API / UGC| Social[LinkedIn & Instagram]
```

---

## 📂 Estructura del Proyecto

* **`Dockerfile`**: Entorno basado en `node:20-alpine` optimizado para Web Scraping. Instala Chromium del sistema para Puppeteer Headless.
* **`compose.yaml`**: Definición de servicios multicontenedor e inyección de todas las variables de entorno necesarias para la IA, bases de datos, redes sociales y correo.
* **`workspace/`**:
  * **`AGENTS.md`**: Definición del perfil, filosofía y habilidades permitidas de **Axio Scout**.
  * **`HEARTBEAT.md`**: Cron de tareas programadas del agente (ejecución cada 2 horas).
  * **`skills/`**: Directorio de habilidades ejecutables:
    * **`mailcow-triage`**: Conexión IMAP a Mailcow, procesamiento semántico de correos con IA (Cloudflare) y creación de respuestas automáticas en borrador (`Drafts`).
    * **`scout-web`**: Web scraping de URLs del catálogo con Puppeteer e integración con PostgreSQL (modo base de datos simulado).
    * **`social-publish`**: Módulo modular de publicación en LinkedIn e Instagram con modo de simulación segura en desarrollo.

---

## ⚙️ Configuración del Entorno (`.env`)

Crea un archivo `.env` en la raíz del proyecto copiando `.env.example` y rellenando los valores necesarios:

| Variable | Descripción | Ejemplo |
|---|---|---|
| `NODE_ENV` | Entorno de ejecución | `production` / `development` |
| `PORT` | Puerto de escucha de la API | `3000` |
| `CLOUDFLARE_AI_ENDPOINT` | API de chat de Cloudflare AI | `https://api.cloudflare.com/...` |
| `CLOUDFLARE_AUTH_TOKEN` | Token Bearer para Cloudflare AI | `tu_token_de_cloudflare` |
| `OLLAMA_MODEL` | Modelo de IA a utilizar | `qwen2.5-coder` |
| `DATABASE_URL` / `POSTGRES_URL` | URL de conexión de Postgres | `postgresql://user:pass@host:5432/db` |
| `LINKEDIN_ACCESS_TOKEN` | Token de acceso de LinkedIn Share API | `tu_token_de_linkedin` |
| `INSTAGRAM_ACCESS_TOKEN` | Token de Graph API para Instagram Business | `tu_token_de_instagram` |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | ID de la cuenta comercial de Instagram | `17841400000000000` |
| `MAILCOW_IMAP_HOST` | Host IMAP de Mailcow | `mail.axiomacreativa.com` |
| `MAILCOW_IMAP_PORT` | Puerto IMAP (SSL) | `993` |
| `MAILCOW_SMTP_HOST` | Host SMTP de Mailcow | `mail.axiomacreativa.com` |
| `MAILCOW_SMTP_PORT` | Puerto SMTP (SSL) | `465` |
| `MAILCOW_USER` | Cuenta de correo del Agente | `scout@axiomacreativa.com` |
| `MAILCOW_PASS` | Contraseña del buzón del Agente | `tu_password_segura` |

---

## 🚀 Despliegue e Inicio

1. Configura el archivo `.env`.
2. Asegúrate de tener una red externa configurada en Docker si utilizas la base de datos interna de la infraestructura de Axioma:
   ```bash
   docker network create axioma-network
   ```
3. Construye e inicia el contenedor en segundo plano:
   ```bash
   docker compose up --build -d
   ```

---

## 📌 Estado del Desarrollo

> [!IMPORTANT]
> **Tareas del Bucle de Latido Desactivadas**:
> Actualmente, las tareas automáticas en `HEARTBEAT.md` están **desactivadas** mediante comentarios de forma intencional hasta que se cree e integre la base de datos de Axioma Core.
> Esto evita excepciones y fallos de conexión cíclicos innecesarios en el contenedor.

> [!TIP]
> **Habilidad `social-publish` en Desarrollo**:
> Si las variables `LINKEDIN_ACCESS_TOKEN` o `INSTAGRAM_ACCESS_TOKEN` no están configuradas con tokens válidos (o mantienen sus valores de ejemplo), la skill operará de forma transparente en **Modo de Simulación**. Esto permite realizar pruebas locales del flujo cognitivo del agente sin disparar peticiones HTTP fallidas a las APIs externas.