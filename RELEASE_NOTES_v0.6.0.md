# Chambinho Code v0.6.0

## Implementado
- Checkpoints de edição persistidos por projeto em `~/.chambinho/checkpoints/<sha256>.json` (ou `CHAMBINHO_STATE_DIR`).
- `:undo` restaura alterações mesmo após reiniciar o processo.
- Verificação de conteúdo impede rollback sobre modificações externas.
- Gravação atômica do registro de checkpoints e permissões restritas no arquivo de estado.
- 17 testes de CLI e 10 testes do gateway aprovados localmente.

## Limitações
- Streaming, MCP, subagentes e execução autônoma de ponta a ponta não estão implementados.
- APIs de terceiros não foram testadas com credenciais reais.
- Checkpoints persistidos contêm cópias anteriores dos arquivos alterados; não edite segredos com o agente e proteja o diretório de estado.
- Ainda não existe isolamento por contêiner dos comandos autorizados.
