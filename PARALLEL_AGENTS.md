# Chambinho Code v0.11 — Parallel Agents (experimental)

Run in the interactive CLI:

```text
/parallel planner: Planeje a interface | auditor: Audite o projeto
/parallel implementer: Crie pagina-a.html | implementer: Crie pagina-b.html
```

- At most four workers run concurrently with independent model conversation contexts and isolated temporary filesystem snapshots.
- Planner and auditor remain read-only. Implementer changes first occur in its temporary workspace and require permission.
- Consolidation checks that only one worker modified each path, and that the live file has not changed since the snapshot. It then asks for permission again before applying a change to the live project.
- Conflicts, deletions, and files changed externally are reported, not auto-merged. Empty original files cannot be replaced automatically.
- The staging snapshot excludes `.env`, credentials, Git metadata, build directories, and symbolic links. It is limited to 350 files / 3 MB, with a 300 KB per-file limit.
- This is NOT an OS-level sandbox: approved commands may have side effects outside the temporary directory (network, external services). Use on trusted projects and review every approval.
- Parallel merge is not transactional: if one approved file is written and another is rejected, the first remains; use `/undo` for the latest checkpoint.
- Real-provider and Windows end-to-end testing remain outstanding.
