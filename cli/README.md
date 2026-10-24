# Chambinho Code — agente de programação no terminal

CLI interativa em TypeScript integrada ao **AI Gateway** FastAPI do repositório pai. A abertura apresenta um mascote compacto em arte ASCII desenhado à mão, com pupilas vazias e menu numerado, inteiramente com caracteres imprimíveis. Não há rasterização, imagens nem SVG.

## Instalação

Requer Node.js 20+ e o gateway da pasta pai funcionando com pelo menos um provedor configurado.

```bash
cd cli
npm install
npm run build
npm link
chambinho --banner
```

No Windows, PowerShell:

```powershell
$env:CHAMBINHO_GATEWAY_URL="http://127.0.0.1:8000"
$env:CHAMBINHO_CLIENT_KEY="SUA_CHAVE_DE_CLIENTE_DO_GATEWAY"
cd C:\caminho\para\meu-repositorio
chambinho
```

No macOS/Linux:

```bash
export CHAMBINHO_GATEWAY_URL=http://127.0.0.1:8000
export CHAMBINHO_CLIENT_KEY='SUA_CHAVE_DE_CLIENTE_DO_GATEWAY'
cd ~/projetos/meu-repositorio
chambinho
```

A chave é definida no `API_CLIENTS_JSON` do gateway. Cadastre um cliente separado:

```json
{
  "chambinho":{"key":"UM_SEGREDO_ALEATORIO_DE_PELO_MENOS_24_CARACTERES","rpm":20,"routes":["code","smart","fast"]}
}
```

A configuração do gateway é lida do ambiente de execução do processo Python. Para testes locais, `python -m dotenv run -- uvicorn app.core:app --reload` pode carregar `.env` após instalar `python-dotenv`; evite versionar ou compartilhar chaves.

## Comandos

- `chambinho` inicia conversa interativa na pasta atual.
- `chambinho -p "explique esta base"` envia uma tarefa em modo não interativo (operações de risco recusadas).
- `chambinho --route fast` altera a rota padrão.
- `chambinho --banner` mostra a mascote e o nome do produto sem requerer credenciais.
- `chambinho doctor` diagnostica Node, token, serviço e rota.
- Comandos do chat: `:help`, `:status`, `:route code|fast|smart`, `:clear`, `:exit`.

## Ferramentas do agente

- `list_files` — listar até 180 arquivos até 4 níveis.
- `read_file` — ler arquivos de texto de até 100 KB.
- `search_text` — procurar texto no projeto.
- `git_status` — consultar alterações git.
- `replace_text` — substituir trecho exato de arquivo, após confirmação.
- `create_file` — criar arquivo sem sobrescrever, após confirmação.
- `run_command` — executar programa em lista permitida **sem shell**, após confirmação; `git` restrito a leitura.

Há limites de 12 etapas de ferramenta por pedido e de tamanho de arquivos; esses limites reduzem riscos, mas não equivalem a uma sandbox de segurança. Execute apenas em repositórios de confiança; revise cada comando e alteração antes de aprovar. Não execute como root. O modelo receberá o conteúdo dos arquivos lidos e resultados dos comandos. Não use a CLI em código confidencial sem verificar o contrato de dados do provedor de IA.

## Estado atual e limitações

- Os modelos são escolhidos pelo gateway, não por um `model` arbitrário passado pelo cliente.
- Não existe suporte a MCP, subagentes, gerenciamento de PRs, UI visual de diffs, streaming de tokens ou indexação vetorial neste MVP.
- O agente solicita ações através de JSON no prompt, sem mecanismo nativo de tool calling; modelos diferentes podem obedecer com confiabilidade distinta.
- Em Windows, os executáveis usados pelo agente devem estar disponíveis no PATH.
- Arquivos confidenciais (`.env`, `.npmrc`, arquivos de chaves), symlinks e pastas de dependências são bloqueados na leitura. Entretanto, **execução de comandos aprovada pode permitir acesso a arquivos e rede por fora desses bloqueios**. O consentimento do usuário é essencial.
- Ferramentas de leitura são automáticas e enviam resultados ao provedor de IA. Para um ambiente com dados sensíveis, utilize um modelo local e adicione isolamento de filesystem/processos.

## Testes

```bash
npm test
```

Os testes utilizam um modelo fake e não exigem internet ou API key. Para teste ponta a ponta real, inicie o gateway e configure chaves verdadeiras.


## Identidade terminal v0.3.1

Comando global: `chambinho`. O banner do coração utiliza somente caracteres ASCII (`#`, `O`, `@`, `^`, `/`, `\`, `_`, etc.), escritos manualmente em um template literal. ANSI 24-bit é opcional apenas para colorir os caracteres. Não há rasterizador, `▀`, SVG, imagens ou fontes externas. Para ver as cores em terminal compatível: `chambinho --banner`. Para forçar cor em pipelines: `FORCE_COLOR=1 chambinho --banner`. Com `NO_COLOR=1`, o mesmo coração é mostrado em ASCII puro, sem escapes ANSI. As variáveis `RAIZ_*` antigas ainda são aceitas como fallback de compatibilidade. O banner requer largura aproximada de 55 colunas.
