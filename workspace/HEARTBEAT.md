# Axioma Core - OpenClaw Heartbeat Loop

## Interval
- Every 2 hours (0 */2 * * *)

## Active Tasks
1. **Task:** Audit New Blog Posts
   - **Skill:** `scout-web`
   - **Action:** Check PostgreSQL database for new articles that lack a `social_shared_at` timestamp.
   
2. **Task:** Email Triage (Mailcow)
   - **Skill:** `mailcow-triage`
   - **Action:** Scan inbox for unread customer inquiries, generate draft replies using Cloudflare Ollama, and save them to Mailcow Drafts.
