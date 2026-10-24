import json
import pytest
from fastapi.testclient import TestClient
import app.core as core

TOKEN='z'*36
@pytest.fixture(autouse=True)
def configure(monkeypatch):
    monkeypatch.setenv('API_CLIENTS_JSON', json.dumps({'catty': {'key': TOKEN, 'rpm': 2, 'routes': ['fast', 'vision', 'transcription']}}))
    monkeypatch.setenv('GROQ_API_KEY', 'fake')
    for key in ['GEMINI_API_KEY', 'MISTRAL_API_KEY', 'CLOUDFLARE_API_TOKEN', 'NVIDIA_API_KEY']:
        monkeypatch.delenv(key, raising=False)
    core.request_log.clear()

client = TestClient(core.app)
headers = {'Authorization': f'Bearer {TOKEN}'}

def test_health():
    assert client.get('/health').json()['status']=='ok'

def test_no_auth():
    assert client.post('/v1/chat', json={'messages':[{'role':'user', 'content':'oi'}]}).status_code==401

def test_route_permission():
    r=client.post('/v1/chat', headers=headers, json={'route':'code','messages':[{'role':'user','content':'oi'}]})
    assert r.status_code==403

def test_chat_success(monkeypatch):
    async def stub(provider, model, payload):
        return {'choices':[{'message':{'content':'Olá'}}], 'usage': {'total_tokens': 12}}
    monkeypatch.setattr(core,'call_provider',stub)
    r=client.post('/v1/chat', headers=headers,json={'route':'fast','messages':[{'role':'user','content':'oi'}]})
    assert r.status_code==200
    assert r.json()['provider']=='groq'
    assert r.json()['content']=='Olá'

def test_rate_limit(monkeypatch):
    async def stub(provider, model, payload):
        return {'choices':[{'message':{'content':'ok'}}]}
    monkeypatch.setattr(core,'call_provider',stub)
    payload={'route':'fast','messages':[{'role':'user','content':'oi'}]}
    assert client.post('/v1/chat',headers=headers,json=payload).status_code==200
    assert client.post('/v1/chat',headers=headers,json=payload).status_code==200
    assert client.post('/v1/chat',headers=headers,json=payload).status_code==429

def test_fallback(monkeypatch):
    monkeypatch.setenv('GEMINI_API_KEY','dummy')
    async def stub(provider, model, payload):
        if provider=='groq':
            raise core.httpx.ConnectError('temporary failure')
        return {'choices':[{'message':{'content':'fallback'}}]}
    monkeypatch.setattr(core,'call_provider',stub)
    r=client.post('/v1/chat',headers=headers,json={'route':'fast','messages':[{'role':'user','content':'hi'}]})
    assert r.status_code==200
    assert r.json()['provider']=='gemini'

def test_reject_external_image_url():
    r=client.post('/v1/chat',headers=headers,json={'route':'vision','messages':[{'role':'user','content':[{'type':'image_url','image_url':{'url':'http://localhost/admin'}}]}]})
    assert r.status_code==422

def test_routes_visibility():
    r=client.get('/v1/routes',headers=headers)
    assert r.status_code==200
    assert 'code' not in r.json()['routes']


def test_nvidia_credentials(monkeypatch):
    monkeypatch.setenv('NVIDIA_API_KEY', 'test-key-not-real')
    assert core.provider_credentials('nvidia') == ('https://integrate.api.nvidia.com/v1', 'test-key-not-real')
    assert ('nvidia', 'qwen/qwen2.5-coder-32b-instruct') in core.ROUTES['code']

def test_nvidia_code_fallback(monkeypatch):
    monkeypatch.setenv('API_CLIENTS_JSON', json.dumps({'chambinho': {'key': TOKEN, 'rpm': 3, 'routes': ['code']}}))
    monkeypatch.setenv('NVIDIA_API_KEY', 'not-a-live-key')
    called = []
    async def stub(provider, model, payload):
        called.append((provider, model))
        return {'choices': [{'message': {'content': 'NVIDIA test response'}}]}
    monkeypatch.setattr(core, 'call_provider', stub)
    response = client.post('/v1/chat', headers=headers, json={'route': 'code', 'messages': [{'role': 'user', 'content': 'test'}]})
    assert response.status_code == 200
    assert response.json()['provider'] == 'nvidia'
    assert called[0][0] == 'nvidia'


def test_stream_requires_authentication():
    from fastapi.testclient import TestClient
    from app.core import app
    response = TestClient(app).post('/v1/chat/stream', json={'route':'code','messages':[{'role':'user','content':'hello'}]})
    assert response.status_code == 401
