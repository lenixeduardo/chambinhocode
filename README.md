# AI Gateway + Chambinho Code

**Chambinho Code** é o agente CLI de programação em TypeScript desta plataforma. A documentação e os testes da CLI estão em [`cli/README.md`](cli/README.md). O backend FastAPI mantém a interface HTTP comum para os demais aplicativos.

### Início rápido com Chambinho Code

Em um terminal, instale as dependências do gateway, configure `API_CLIENTS_JSON` com um cliente `chambinho` e a chave do provedor de IA e inicie o FastAPI:

```bash
python -m venv .venv
# Ative o ambiente virtual e instale: pip install -r requirements-dev.txt
# Defina as variáveis no ambiente, ou instale python-dotenv para carregar o .env:
python -m dotenv run -- uvicorn app.core:app --host 127.0.0.1 --port 8000
```

Em outro terminal:

```bash
cd cli
npm install
npm run build
npm link
# Configure CHAMBINHO_CLIENT_KEY e, opcionalmente, CHAMBINHO_GATEWAY_URL; veja cli/README.md.
cd /caminho/do/seu/projeto
chambinho
```

No Windows PowerShell, use `$env:CHAMBINHO_CLIENT_KEY="SUA_CHAVE"`; no Linux/macOS use `export CHAMBINHO_CLIENT_KEY=...`. O CLI exige acesso a um gateway em execução e a uma chave de provedor configurada. **Não existe acesso gratuito garantido**: respeite limites e termos da API selecionada.


Gateway FastAPI for Groq, Gemini, Mistral, Cloudflare Workers AI, with app-specific API keys and model fallbacks. Also provides Groq Whisper audio transcription.

## Start

```bash
python -m venv .venv
# Activate virtualenv
pip install -r requirements-dev.txt
cp .env.example .env
# Populate environment variables from .env with your terminal/service env manager.
uvicorn app.core:app --host 127.0.0.1 --port 8000
pytest -q
```

For local `.env` loading: `pip install python-dotenv` then `python -m dotenv run -- uvicorn app.core:app --reload` (or use `docker run --env-file .env`). Never expose service keys in frontend.

## Routes
- `GET /health`: no auth
- `GET /v1/routes`: authenticated routes and configured providers
- `POST /v1/chat`: body `{ "route":"fast", "messages":[{"role":"user","content":"Olá"}] }`
- `POST /v1/transcriptions`: multipart `file` + `language` (pt/en/es), available to authorized transcription tenants

Examples:

```bash
curl http://127.0.0.1:8000/health
curl -X POST http://127.0.0.1:8000/v1/chat \
  -H "Authorization: Bearer $CLIENT_KEY" -H 'Content-Type: application/json' \
  -d '{"route":"fast","messages":[{"role":"user","content":"Olá"}]}'
```

## Security / production considerations
- Client keys belong in server-side env vars, not browser/mobile apps. Use a Supabase Edge Function to mediate authenticated end users.
- Per-app quotas are local, per minute, **not distributed**. Deploy one worker until Redis-based quotas are added.
- Only metadata is logged. Prompts and audio are not intentionally persisted.
- Provider vendors may retain prompts. Review privacy terms for sensitive data.
- No usage billing ledger, organization administration UI, websocket audio streaming, semantic cache or Redis yet.
- Routes and exact upstream model availability change. Validate against provider accounts before going live.
- Fallback is used for transport faults, timeouts and provider 429/5xx; other upstream rejections produce 502 instead of silently switching models.
- Restrict inbound body size at the reverse proxy; in-code audio upload limit is 10 MB. Use HTTPS and rotate credentials.
- Vision accepts base64 data:image URLs only, to prevent server-side fetching arbitrary URLs.

## Compatibility references
- Groq https://console.groq.com/docs/overview
- Gemini https://ai.google.dev/gemini-api/docs/openai
- Cloudflare https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/

## Supabase integration

`examples/supabase-edge-function.ts` shows a protected Edge Function which verifies the end user's Supabase access token before forwarding to this gateway. Put `AI_GATEWAY_CLIENT_KEY` in Edge Function secrets, not in client code. The sample is **not deployed** and does not implement per-user quotas; add those before public launch. The gateway itself needs no Supabase database and does not alter existing Supabase projects.

### NVIDIA NIM (Chambinho Code)

O gateway possui fallback NVIDIA NIM nas rotas `fast`, `smart` e `code`.
Em `code`, ele tenta Mistral Codestral primeiro e depois NVIDIA NIM
(`qwen/qwen2.5-coder-32b-instruct`), antes do Groq.

Configure `NVIDIA_API_KEY` apenas no ambiente do **servidor** (nunca no terminal cliente, frontend ou Git).
O endpoint utilizado é `https://integrate.api.nvidia.com/v1/chat/completions`.
Use `chambinho doctor` para verificar se o provedor está configurado no gateway.
Modelos e franquias disponíveis podem mudar; confirme no catálogo NVIDIA.

## Atualização v0.5.0

CLI: `chambinho`. Comandos de sessão: `:save`, `:resume`, `:undo`, `:status`.
A prévia de alterações usa formato textual com linhas `-` e `+`, com aprovação obrigatória.
O comando `:undo` desfaz a última edição aprovada na sessão corrente e recusa conflitos.
O histórico salvo fica na pasta `~/.chambinho/sessions` e pode conter trechos de código;
proteja seu perfil de usuário e não inclua segredos em prompts.

**Ainda não é 9,5/10:** chamadas reais aos provedores, streaming de tokens,
subagentes, MCP e validação em projeto de produção permanecem pendentes.

## v0.6.0 — rollback persistente

O comando `:undo` agora funciona após reiniciar a CLI. Os checkpoints são gravados fora do repositório em `~/.chambinho/checkpoints/` e associados ao caminho absoluto do projeto. Para alterar o local de armazenamento, defina `CHAMBINHO_STATE_DIR`. Esses arquivos podem conter cópias do código editado; mantenha o diretório protegido. Não use com segredos. Consulte `RELEASE_NOTES_v0.6.0.md` para limitações.


### Verificação v0.7.0
Após editar arquivos, Chambinho solicita aprovação para executar testes. Sem resultado de comando com exit=0, a resposta final informa que as alterações não foram validadas. Este mecanismo é uma indicação de execução, não uma prova de cobertura adequada.

### v0.8.0 — Streaming e planejamento
O endpoint `POST /v1/chat/stream` transmite eventos SSE `meta`, `delta`, `done` e `error`.
O CLI tenta streaming primeiro, com fallback para o endpoint anterior quando o gateway não o oferece.
Em tarefas complexas, o modelo pode enviar uma ação `plan` antes das ações de ferramenta.
Falhas de comunicação são tentadas novamente até três vezes no total, sem repetição automática de ações de escrita.
O progresso de tokens é representado por pontos para não imprimir JSON de ferramentas e possíveis conteúdos de arquivos.
A versão não garante recuperação de streams interrompidos após tokens parciais, nem aprovação automática de alterações.
