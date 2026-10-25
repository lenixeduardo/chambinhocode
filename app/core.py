"""Provider-neutral AI gateway; credentials and routing are configured via environment."""
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path
import secrets
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any

import httpx
from fastapi import FastAPI, Depends, Header, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, ConfigDict

logging.basicConfig(level=os.environ.get('LOG_LEVEL', 'INFO'))
logger = logging.getLogger('ai_gateway')
app = FastAPI(title='Reusable AI Gateway', version='0.1.0', docs_url='/docs' if os.getenv('ENABLE_DOCS', 'false').lower() == 'true' else None)

# Aliases are server-owned. Clients cannot supply arbitrary external URLs or model IDs.
ROUTES = {
    'fast': [('groq', 'openai/gpt-oss-20b'), ('nvidia', 'openai/gpt-oss-20b'), ('gemini', 'gemini-2.5-flash-lite'), ('cloudflare', '@cf/openai/gpt-oss-20b')],
    'smart': [('gemini', 'gemini-2.5-flash'), ('groq', 'openai/gpt-oss-120b'), ('nvidia', 'nvidia/nemotron-3-super-120b-a12b'), ('mistral', 'mistral-small-latest')],
    'vision': [('gemini', 'gemini-2.5-flash')],
    'code': [('mistral', 'codestral-latest'), ('nvidia', 'qwen/qwen2.5-coder-32b-instruct'), ('groq', 'openai/gpt-oss-120b')],
}
BASE_URLS = {
    'groq': 'https://api.groq.com/openai/v1',
    'gemini': 'https://generativelanguage.googleapis.com/v1beta/openai',
    'mistral': 'https://api.mistral.ai/v1',
    'nvidia': 'https://integrate.api.nvidia.com/v1',
    'cloudflare': 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',
}
KEY_ENV = {'groq': 'GROQ_API_KEY', 'gemini': 'GEMINI_API_KEY', 'mistral': 'MISTRAL_API_KEY', 'nvidia': 'NVIDIA_API_KEY', 'cloudflare': 'CLOUDFLARE_API_TOKEN'}
RETRIABLE = {408, 409, 425, 429, 500, 502, 503, 504}

class Message(BaseModel):
    role: str
    content: Any

class ChatInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    route: str = 'fast'
    messages: list[Message] = Field(min_length=1, max_length=60)
    max_tokens: int = Field(default=512, ge=1, le=4096)
    temperature: float = Field(default=0.5, ge=0, le=2)

class ChatOutput(BaseModel):
    id: str
    provider: str
    model: str
    route: str
    content: str
    usage: dict[str, Any] = Field(default_factory=dict)

@dataclass
class Tenant:
    name: str
    quota: int
    allowed_routes: set[str]

# Configure API_CLIENTS_JSON with a JSON object like:
# {"catty":{"key":"<long random key>","rpm":30,"routes":["fast","smart"]}}
# In-memory quotas are safe for a *single* process only. Use Redis for multi-instance deployments.
request_log: dict[str, deque[float]] = defaultdict(deque)
rate_lock = asyncio.Lock()

def load_clients() -> dict[str, dict]:
    try:
        entries = json.loads(os.getenv('API_CLIENTS_JSON', '{}'))
        if not isinstance(entries, dict):
            raise ValueError('API_CLIENTS_JSON must be an object')
        return entries
    except (ValueError, TypeError) as exc:
        logger.error('Invalid API_CLIENTS_JSON configuration: %s', exc)
        raise RuntimeError('Invalid API_CLIENTS_JSON configuration') from exc

def load_local_client() -> dict | None:
    """Accept the per-user localhost key without registering it in API_CLIENTS_JSON."""
    # Gateway MUST be bound to loopback by the process launcher. Requests are also
    # restricted below, so a mistakenly public bind cannot expose this credential.
    credential_path = Path.home() / '.chambinho' / 'local-client.json'
    try:
        if credential_path.is_symlink():
            return None
        record = json.loads(credential_path.read_text(encoding='utf-8'))
        key = record.get('key', '')
        if isinstance(key, str) and len(key) == 24:
            return record
    except (OSError, ValueError, AttributeError, TypeError):
        pass
    return None

def resolve_tenant(request: Request, authorization: str | None = Header(default=None)) -> Tenant:
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Missing bearer token')
    supplied = authorization[7:]
    local = load_local_client()
    if (request.client and request.client.host in {'127.0.0.1', '::1'} and local and secrets.compare_digest(supplied, local['key'])):
        return Tenant('chambinho-local', 20, {'code', 'smart', 'fast'})
    clients = load_clients()
    for name, settings in clients.items():
        key = settings.get('key', '')
        if len(key) >= 24 and secrets.compare_digest(supplied, key):
            return Tenant(name, int(settings.get('rpm', 20)), set(settings.get('routes', ['fast'])))
    raise HTTPException(401, 'Invalid credentials')

async def require_quota(tenant: Tenant = Depends(resolve_tenant)) -> Tenant:
    now = time.monotonic()
    async with rate_lock:
        events = request_log[tenant.name]
        while events and events[0] <= now - 60:
            events.popleft()
        if len(events) >= tenant.quota:
            raise HTTPException(429, 'Per-client request quota exceeded', headers={'Retry-After': '60'})
        events.append(now)
    return tenant

def provider_credentials(provider: str) -> tuple[str, str] | None:
    token = os.getenv(KEY_ENV[provider], '')
    if not token:
        return None
    url = BASE_URLS[provider]
    if provider == 'cloudflare':
        account_id = os.getenv('CLOUDFLARE_ACCOUNT_ID', '')
        if not account_id:
            return None
        url = url.format(account_id=account_id)
    return url, token

async def call_provider(provider: str, model: str, payload: ChatInput) -> dict:
    credentials = provider_credentials(provider)
    if credentials is None:
        raise RuntimeError('Provider is not configured')
    base_url, token = credentials
    body = {'model': model, 'messages': [m.model_dump() for m in payload.messages], 'max_tokens': payload.max_tokens, 'temperature': payload.temperature, 'stream': False}
    async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=5), follow_redirects=False) as client:
        response = await client.post(f'{base_url}/chat/completions', json=body, headers={'Authorization': f'Bearer {token}'})
    if response.status_code >= 400:
        raise httpx.HTTPStatusError(f'{provider} HTTP {response.status_code}', request=response.request, response=response)
    return response.json()

@app.get('/health')
def health():
    return {'status': 'ok', 'version': '0.1.0'}

@app.get('/v1/routes')
def routes(tenant: Tenant = Depends(resolve_tenant)):
    return {'routes': {route: [{'provider': p, 'model': m, 'configured': bool(provider_credentials(p))} for p, m in targets] for route, targets in ROUTES.items() if route in tenant.allowed_routes}}

@app.post('/v1/chat', response_model=ChatOutput)
async def chat(payload: ChatInput, tenant: Tenant = Depends(require_quota)):
    if payload.route not in ROUTES or payload.route not in tenant.allowed_routes:
        raise HTTPException(403, 'Route not allowed')
    # Restrict content type; do not relay arbitrary tool calls, URLs or arbitrary JSON.
    for msg in payload.messages:
        if msg.role not in {'system', 'user', 'assistant'}:
            raise HTTPException(422, 'Unsupported role')
        if not isinstance(msg.content, (str, list)):
            raise HTTPException(422, 'Invalid content type')
        if isinstance(msg.content, list):
            if payload.route != 'vision':
                raise HTTPException(422, 'Image messages require vision route')
            for part in msg.content:
                if not isinstance(part, dict) or part.get('type') not in {'text', 'image_url'}:
                    raise HTTPException(422, 'Unsupported multimodal content')
                if part.get('type') == 'image_url':
                    image = part.get('image_url', {})
                    if not isinstance(image, dict) or not str(image.get('url', '')).startswith('data:image/') or len(str(image['url'])) > 4_000_000:
                        raise HTTPException(422, 'Only bounded data:image URLs are supported')
    trace_id = uuid.uuid4().hex
    attempted = []
    start = time.monotonic()
    for provider, model in ROUTES[payload.route]:
        if provider_credentials(provider) is None:
            continue
        attempted.append(provider)
        try:
            data = await call_provider(provider, model, payload)
            content = data['choices'][0]['message']['content']
            if not isinstance(content, str):
                raise ValueError('Non-text response')
            usage = data.get('usage') or {}
            logger.info('chat trace=%s tenant=%s provider=%s latency_ms=%d', trace_id, tenant.name, provider, round((time.monotonic()-start)*1000))
            return ChatOutput(id=trace_id, provider=provider, model=model, route=payload.route, content=content, usage=usage)
        except httpx.HTTPStatusError as exc:
            logger.warning('provider_failure trace=%s provider=%s status=%s', trace_id, provider, exc.response.status_code)
            if exc.response.status_code not in RETRIABLE:
                raise HTTPException(502, 'Upstream rejected request')
        except (httpx.TimeoutException, httpx.TransportError, RuntimeError, ValueError, KeyError, IndexError) as exc:
            logger.warning('provider_failure trace=%s provider=%s type=%s', trace_id, provider, type(exc).__name__)
    logger.error('all_providers_failed trace=%s tenant=%s attempted=%s', trace_id, tenant.name, attempted)
    raise HTTPException(503, 'No AI provider available; verify credentials and quotas')

@app.post('/v1/chat/stream')
async def chat_stream(payload: ChatInput, tenant: Tenant = Depends(require_quota)):
    """SSE tokens from upstream; fail over only before the first token is emitted."""
    if payload.route not in ROUTES or payload.route not in tenant.allowed_routes:
        raise HTTPException(403, 'Route not allowed')
    if any(m.role not in {'system', 'user', 'assistant'} or not isinstance(m.content, str) for m in payload.messages):
        raise HTTPException(422, 'Streaming accepts text messages only')

    async def events():
        started = False
        for provider, model in ROUTES[payload.route]:
            credentials = provider_credentials(provider)
            if credentials is None:
                continue
            base_url, token = credentials
            body = {'model': model, 'messages': [m.model_dump() for m in payload.messages],
                    'max_tokens': payload.max_tokens, 'temperature': payload.temperature, 'stream': True}
            try:
                async with httpx.AsyncClient(timeout=httpx.Timeout(65, connect=5), follow_redirects=False) as client:
                    async with client.stream('POST', f'{base_url}/chat/completions', json=body,
                                             headers={'Authorization': f'Bearer {token}'}) as response:
                        if response.status_code >= 400:
                            if response.status_code not in RETRIABLE:
                                yield 'event: error\ndata: {"message":"Upstream rejected request"}\n\n'
                                return
                            continue
                        async for line in response.aiter_lines():
                            if not line.startswith('data: '):
                                continue
                            data = line[6:]
                            if data == '[DONE]':
                                yield 'event: done\ndata: {}\n\n'
                                return
                            try:
                                chunk = json.loads(data)
                                delta = chunk['choices'][0].get('delta', {}).get('content')
                            except (ValueError, KeyError, IndexError, TypeError):
                                continue
                            if isinstance(delta, str) and delta:
                                if not started:
                                    started = True
                                    yield f'event: meta\ndata: {json.dumps({"provider":provider,"model":model})}\n\n'
                                yield f'event: delta\ndata: {json.dumps({"content":delta})}\n\n'
                        if started:
                            yield 'event: error\ndata: {"message":"Upstream stream ended unexpectedly"}\n\n'
                            return
            except (httpx.HTTPError, RuntimeError) as exc:
                logger.warning('stream_failure provider=%s type=%s', provider, type(exc).__name__)
                if started:
                    yield 'event: error\ndata: {"message":"Upstream stream interrupted"}\n\n'
                    return
        yield 'event: error\ndata: {"message":"No AI provider available"}\n\n'

    return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

@app.post('/v1/transcriptions')
async def transcribe(file: UploadFile = File(...), language: str = Form('pt'), tenant: Tenant = Depends(require_quota)):
    if 'transcription' not in tenant.allowed_routes:
        raise HTTPException(403, 'Route not allowed')
    if language not in {'pt', 'en', 'es'}:
        raise HTTPException(422, 'Unsupported language')
    if file.content_type not in {'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/webm', 'audio/ogg'}:
        raise HTTPException(415, 'Unsupported audio format')
    data = await file.read(10_000_001)
    if len(data) > 10_000_000:
        raise HTTPException(413, 'Audio exceeds 10 MB')
    token = os.getenv('GROQ_API_KEY', '')
    if not token:
        raise HTTPException(503, 'Transcription provider not configured')
    try:
        async with httpx.AsyncClient(timeout=75, follow_redirects=False) as client:
            result = await client.post('https://api.groq.com/openai/v1/audio/transcriptions', headers={'Authorization': f'Bearer {token}'}, files={'file': (file.filename or 'audio.wav', data, file.content_type)}, data={'model': os.getenv('GROQ_TRANSCRIPTION_MODEL', 'whisper-large-v3-turbo'), 'language': language, 'response_format': 'json'})
        result.raise_for_status()
        return {'text': result.json()['text'], 'provider': 'groq'}
    except (httpx.HTTPError, KeyError, ValueError):
        raise HTTPException(502, 'Transcription provider failed')
