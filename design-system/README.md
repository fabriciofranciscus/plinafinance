# Plina Finance Design System v1.2

Doutrina visual revisada em 17/11/2026 por solicitação da Thais, via Atlas. Pacote de documentação e tokens; não altera a aplicação.

| Arquivo | Função |
|---|---|
| plina-design-system.md | Contrato visual autoritativo, regras e aceite (§13) |
| tokens.json | Valores e aliases legíveis por máquina |
| tokens.css | Variáveis CSS e primitivas; `.plina-product` ativa regras operacionais |
| tailwind-v4.css | Tema de referência para incorporação pela Flora |
| PROMPT.md | Resumo para ferramentas e contexto curto |

Tokens usam a convenção `$type`/`$value`/aliases inspirada em DTCG. O arquivo preserva expressões CSS (clamp, rgba, gradientes e durações em string) e extensões legadas; **não é anunciado como conforme a um schema DTCG estrito**. Os exports são mantidos manualmente, não há gerador automático. Validar valores antes de portar para Figma/Style Dictionary.

Mudanças: raio 12/16; elevação none/raised/overlay; hierarquia operacional e labels em caixa de frase; Phosphor regular; tempos 120–320ms e reduced motion; densidade por tarefa. Paleta de marca preservada. `elevation.cta` fica como alias depreciado de raised. Os nomes editoriais existentes continuam disponíveis.

Não copiar antigas instruções de raio binário, sombra única ou uppercase universal do DESIGN.md ou dos materiais históricos. Sua nota de precedência aponta para a v1.2. Copy de domínio é mantida; pendências jurídicas não são resolvidas por esta revisão.

Validação local:

```bash
python3 -m json.tool design-system/tokens.json > /dev/null
node design-system/check-contrast.mjs
git diff --check
```

O checker contém pares fixos: confirma a paleta de referência, não varre a aplicação nem substitui o contraste composto no navegador. Implementação segue admin → investidor → cedente/comprador, em PRs por tela. Rever screenshots, teclado, zoom 200%, reflow 320px e movimento reduzido. Dependência de ícones segue revisão normal de deps; nenhum pacote foi instalado nesta entrega.
