# Overrides

Camada de personalização do stellar-build. Nada aqui é sobrescrito por updates —
ao contrário dos `customize.toml` dentro de cada skill, que são regenerados.

| Arquivo | Escopo | Versionado |
|---|---|---|
| `config.toml` | roster de agentes — overrides de time | sim |
| `config.user.toml` | roster de agentes — overrides pessoais | não |
| `<skill-name>.toml` | uma skill/persona — overrides de time | sim |
| `<skill-name>.user.toml` | uma skill/persona — overrides pessoais | não |

`<skill-name>` é o nome da pasta da skill: `nicole-pm`, `elliot-dev`,
`tyler-architect`, `kaan-ux-designer`, `bri-tech-writer`, `justin-analyst`,
`prd`, `product-brief`, …

## Regras de merge

- **escalares** — o override vence
- **tabelas** — deep-merge
- **arrays de tabelas com `code`/`id`** — entradas com chave igual são
  substituídas, novas são anexadas
- **demais arrays** — anexados (base primeiro)

## Exemplo

Dar ao Tyler contexto regulatório permanente e um item de menu novo:

```toml
# custom/tyler-architect.toml
[agent]
persistent_facts = [
  "O veículo é um FIDC sob CVM 175 — toda decisão de arquitetura que toque emissão, custódia ou clawback precisa ser defensável perante o regulador.",
  "file:{project-root}/docs/ESTUDO-CUSTODIA.md",
]

[[agent.menu]]
code = "SOR"
description = "Desenhar o waterfall on-chain em Soroban (M7)"
prompt = "Projete o contrato de waterfall descrito no PRD §M7, partindo da cascata que hoje roda em lib/services/pool.ts."
```

Conferir o resultado:

```bash
python3 .stellar-build/scripts/resolve_customization.py \
  --skill ~/.claude/skills/tyler-architect --key agent
```
