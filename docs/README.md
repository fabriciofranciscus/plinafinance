# Implementation log

Histórico de implementações que mudam comportamento do sistema. Diferente do whitepaper (fonte canônica de produto), do ONBOARDING.md (manual de entrada do dev) e do código (estado atual): aqui registra o **processo** — o gap encontrado, o que foi considerado, o que foi escolhido e por quê.

## Como usar

- Um arquivo por entrega de escopo material. Prefixo `YYYY-MM-DD-<slug>.md`.
- Estrutura mínima: **Contexto** (gap/oportunidade) · **Decisões** (com alternativas rejeitadas e motivo) · **Implementação** (alto nível, sem duplicar código) · **Limitações conhecidas** · **Próximos passos**.
- Não substitui PRs nem commit messages. É o "porquê" que sobrevive ao refactor.

## Índice

| Data | Escopo | Doc |
|---|---|---|
| 2026-05-18 | Fechamento do gap de emissão arbitrária — Quote binding + swap atômico | [2026-05-18-quote-binding-and-atomic-swap.md](./2026-05-18-quote-binding-and-atomic-swap.md) |
