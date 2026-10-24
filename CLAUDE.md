# AI Gateway — engineering guide
- FastAPI entrypoint: app/core.py; consumers: backend services, never browsers with tenant keys.
- Routes: fast (Groq > Gemini > Cloudflare), smart (Gemini > Groq > Mistral), vision (Gemini), code (Mistral > Groq).
- Add a model by changing ROUTES. Only static, server-owned upstream endpoints are allowed.
- Do not log raw prompts or provider credentials. Never commit .env.
- Maintain tenant isolation; routes are whitelisted per key.
- Rate limiting is per-process. Before using multiple replicas, replace with atomic Redis quotas and add abuse monitoring.
- Avoid modifying existing Supabase projects; migrations in supabase/ are opt-in.
- Tests must pass with pytest -q. Mock upstream APIs; live connectivity requires credentials.
