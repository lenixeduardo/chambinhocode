# Chambinho Code 0.5.0

## Implementado e testado
- Prévia de diff textual antes de aprovar substituições.
- Checkpoints por sessão para edições e criação de arquivos, com `:undo` e detecção de conflitos.
- Persistência local de conversas por projeto via `:save` e `:resume` em `~/.chambinho/sessions`.
- Sanitização adicional das credenciais NVIDIA NIM e Chambinho ao executar subprocessos.
- Identidade do agente atualizada de RAIZ para Chambinho.
- 16 testes da CLI e 10 do gateway aprovados localmente.

## Limites conhecidos
- Não foram executadas chamadas com credenciais reais de provedores.
- Streaming de tokens não está implementado; a CLI mostra eventos após cada resposta de modelo.
- Checkpoints não sobrevivem ao encerramento da CLI; o histórico de conversa sim.
- Não há subagentes, MCP nem indexação semântica de projetos.
- A execução de comandos depende de aprovação e não equivale a um sandbox de segurança.
- Não foi realizado benchmark comparativo com Claude Code, nem validação de produção.

## v0.7.0 — Verificação de alterações
- Agente passa a incentivar execução de testes após editar arquivos.
- Respostas finais não podem passar silenciosamente como validadas se houve alteração sem comando de teste aprovado e concluído com exit=0.
- Falha posterior de testes remove o estado de validação.
- Limite de ações por tarefa aumentado de 12 para 16.
- Dois novos testes automatizados da CLI.
- Ainda pendentes: streaming, validação real de provedores, MCP e subagentes.

## v0.8.0 (2026-10-23)
- Streaming SSE de tokens via `/v1/chat/stream`, com fallback entre provedores apenas antes do primeiro token.
- Cliente CLI recebe fragmentos em tempo real; terminal mostra indicador de progresso sem expor JSON bruto de ferramentas.
- Compatibilidade com gateways antigos (404/405 -> `/v1/chat`).
- Planejamento estruturado de até oito etapas, exibido antes das ações.
- Até duas novas tentativas em falhas de comunicação; correção solicitada ao modelo após resposta JSON inválida.
- Testes locais: 22 CLI, 11 gateway. Testes autenticados dos provedores não executados.
