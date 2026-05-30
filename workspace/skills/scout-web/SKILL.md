# Skill: Scout Web & DB Audit

## Description
Audits the Axioma PostgreSQL database for new content and scrapes specified local/external URLs to understand services and generate social media copy.

## Inputs
- `mode`: "db_audit" or "url_scrape"
- `targetUrl`: (Optional) URL to scrape if mode is url_scrape

## Outputs
- `status`: success/failed
- `payload`: Markdown text containing raw content or generation drafts.
