<div align="center">

![Chambinho Code](assets/chambinho-cover.svg)

# Chambinho Code

**Seu agente de programação no terminal.** Planeje, implemente, audite e valide projetos com auxílio de IA.

![Versão](https://img.shields.io/badge/version-0.12.0-7c3aed) ![Node](https://img.shields.io/badge/Node.js-20%2B-111827) ![Python](https://img.shields.io/badge/Python-FastAPI-3776ab) ![Playwright](https://img.shields.io/badge/Visual_QA-Playwright-a855f7)

</div>

## O que é

Chambinho Code é uma CLI em **TypeScript** conectada a um gateway **Python/FastAPI**. Oferece fluxo assistido de programação, execução de ferramentas com aprovação, skills locais, subagentes especializados, coordenação paralela e auditoria estrutural de páginas com Playwright.

## Recursos

- **Agente de código:** lê e busca arquivos, propõe alterações e executa comandos com confirmação.
- **Subagentes:** separa planejamento, implementação e auditoria.
- **Execução paralela:** coordena tarefas e detecta conflitos antes de consolidar alterações.
- **Skills:** reutiliza instruções locais em arquivos `SKILL.md`.
- **Visual QA:** `/visual` abre uma página em Chromium e captura desktop (1440×900) e mobile (390×844), além de registrar erros JavaScript, imagens quebradas e overflow horizontal.
- **Gateway multi-provedor:** integração configurável com provedores de IA; disponibilidade e cobrança dependem de suas próprias chaves.

## Instalação

Requisitos: Node.js 20+, Python e acesso às APIs dos provedores que você configurar.

### 1. Gateway (terminal 1)

```bash
git clone https://github.com/lenixeduardo/chambinhocode.git
cd chambinhocode
python -m venv .venv
# Ative o ambiente virtual (no Windows Git Bash: source .venv/Scripts/activate)
pip install -r requirements.txt
cp .env.example .env
# Edite .env com suas próprias chaves; nunca publique o arquivo.
python -m dotenv -f .env run -- python -m uvicorn app.core:app --host 127.0.0.1 --port 8000
```

Caso `python -m dotenv` não esteja disponível, instale `python-dotenv` ou carregue as variáveis de ambiente por outro meio. No Windows, use o Python do ambiente virtual explicitamente se necessário.

### 2. CLI (terminal 2)

```bash
cd cli
npm install
npx playwright install chromium
npm run build
export CHAMBINHO_GATEWAY_URL=http://127.0.0.1:8000
export CHAMBINHO_CLIENT_KEY=SUA_CHAVE_DE_CLIENTE
node dist/index.js
```

A chave `CHAMBINHO_CLIENT_KEY` deve corresponder à configuração do cliente `chambinho` em `API_CLIENTS_JSON` no gateway. No PowerShell, use `$env:CHAMBINHO_CLIENT_KEY="..."` em vez de `export`.

## Comandos

```text
/goal Crie uma landing page responsiva
/parallel Implemente componentes independentes
/visual index.html
/visual http://127.0.0.1:5173/
```

Consulte [documentação da CLI](cli/README.md), [Visual QA](VISUAL_QA.md) e [coordenação paralela](PARALLEL_AGENTS.md) para detalhes de cada fluxo. A análise visual automatizada da v0.12.0 verifica aspectos técnicos; **não equivale a uma avaliação estética multimodal**.

## Testes

```bash
cd cli && npm test
# Na raiz, com as dependências de desenvolvimento instaladas:
pytest -q
```

Os testes dependem de ambiente e credenciais apropriados. A instalação do Chromium é necessária para executar capturas reais.

## Identidade visual

- [Capa vetorial para README](assets/chambinho-cover.svg)
- [Favicon SVG — mascote coração](assets/favicon.svg)

## Segurança

Nunca faça commit de `.env`, tokens, credenciais, `node_modules`, `.venv` ou capturas com dados sensíveis. As ações de escrita e execução do agente exigem aprovação; revise o que será alterado antes de confirmar.

## Contribuição

Abra uma [issue](https://github.com/lenixeduardo/chambinhocode/issues) para relatar erros ou propor melhorias. Pull Requests são bem-vindas.
