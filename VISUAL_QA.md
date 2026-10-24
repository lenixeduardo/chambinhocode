# Visual QA — Chambinho v0.12.0

O comando `/visual index.html` ou `/visual http://localhost:3000` abre Chromium com Playwright, gera screenshots **desktop (1440×900)** e **mobile (390×844)** em `.chambinho/visual/` e salva `report.json`.

## Instalação Windows (Git Bash)

Na pasta `cli`:

```bash
npm install
npx playwright install chromium
npm run build
node dist/index.js
```

Na CLI: `/visual index.html` ou `/visual http://127.0.0.1:5173/` (com servidor de desenvolvimento iniciado).

O relatório verifica HTTP, erros JS, imagens quebradas, overflow horizontal, H1 e alvos interativos pequenos. **Não é uma avaliação estética por visão computacional**: screenshots precisam de inspeção humana ou de um modelo multimodal. O comando não atribui uma nota subjetiva nem altera arquivos. Não use URLs com conteúdo confidencial sem avaliar os riscos. A URL é visitada por um navegador real, podendo executar scripts da página.
