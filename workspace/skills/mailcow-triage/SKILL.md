# Skill: Mailcow Email Triage

## Description
Connects to the Axioma Mailcow server via IMAP to read unread business inquiries, processes them using the Cloudflare Worker (Ollama), and saves a tailored draft response back to Mailcow via SMTP/IMAP.

## Inputs
- `maxEmails`: Maximum number of unread emails to process per batch (Default: 5).

## Outputs
- `status`: success/failed
- `processedCount`: Number of emails evaluated and drafted.
