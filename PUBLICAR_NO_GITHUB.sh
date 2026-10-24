#!/usr/bin/env bash
set -euo pipefail
# Execute a partir desta pasta extraida, no Git Bash.
if [ ! -f cli/src/visual.ts ] || [ ! -f cli/src/parallel.ts ] || [ ! -f cli/src/skills.ts ]; then
  echo 'ERRO: fontes da v0.12.0 nao encontrados.' >&2; exit 1
fi
if [ -e .env ]; then
  echo 'AVISO: .env local presente; .gitignore deve exclui-lo.'
fi
if [ ! -d .git ]; then git init; fi
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/lenixeduardo/chambinhocode.git
git fetch origin main
git checkout -B release/v0.12.0-integracao origin/main
git add -A
if git diff --cached --name-only | grep -E '(^|/)(\.env|node_modules|\.venv)(/|$)'; then
  echo 'ERRO: arquivos privados ou dependencias no stage' >&2; exit 1
fi
git status --short
git commit -m 'feat: integrate Chambinho Code v0.12.0 visual QA and parallel agents'
git push -u origin release/v0.12.0-integracao
printf '\nBranch publicada. Abra PR para main: https://github.com/lenixeduardo/chambinhocode/compare/main...release/v0.12.0-integracao?expand=1\n'
