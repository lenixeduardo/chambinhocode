# Chambinho Code v0.8.1 — Windows / Git Bash

Corrigidos os caminhos de entrada da CLI em testes Windows com `fileURLToPath`, a comparação do mascote com ANSI e a exibição de caminhos relativos em formato `/`.

## Testar no Windows (Git Bash)

```bash
cd cli
npm install
npm test
node dist/index.js --banner
```

Os testes da CLI esperados são 22/22. No gateway: `python -m pytest -q` na raiz. As dependências Node não estão incluídas no ZIP; instale com `npm install`.

As correções foram verificadas neste ambiente Linux com Node 22. A execução nativa no Windows ainda deve ser confirmada pelo usuário.
