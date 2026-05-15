---
name: Plina Finance
description: Tokenizadora institucional de direito creditório · FIDC sob CVM 175 · Stellar
colors:
  deep-petrol: "#132728"
  auditable-cyan: "#0EA7C7"
  auditable-cyan-deep: "#057A99"
  stellar-mid: "#4A9ED4"
  glacier-tint: "#A0CFE7"
  document-grey: "#e4e4e4"
  sheet-white: "#ffffff"
  hairline: "#1327281f"
typography:
  display:
    fontFamily: "Chillax, sans-serif"
    fontSize: "clamp(2rem, 5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Chillax, sans-serif"
    fontSize: "clamp(1.875rem, 3.5vw, 3rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Chillax, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Satoshi, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 300
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Geist, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.2em"
  mono:
    fontFamily: "Geist Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.05em"
rounded:
  none: "0"
  full: "9999px"
spacing:
  hairline: "1px"
  xs: "8px"
  sm: "16px"
  md: "32px"
  lg: "64px"
  xl: "128px"
  xxl: "160px"
components:
  button-primary:
    backgroundColor: "{colors.deep-petrol}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "20px 40px"
  button-primary-hover:
    backgroundColor: "{colors.auditable-cyan}"
    textColor: "{colors.sheet-white}"
  button-ghost:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.deep-petrol}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "10px 20px"
  input:
    backgroundColor: "{colors.document-grey}"
    textColor: "{colors.deep-petrol}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "16px 28px"
  chip:
    backgroundColor: "{colors.document-grey}"
    textColor: "{colors.deep-petrol}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  card-tile:
    backgroundColor: "{colors.sheet-white}"
    textColor: "{colors.deep-petrol}"
    rounded: "{rounded.none}"
    padding: "32px"
  topbar:
    backgroundColor: "{colors.auditable-cyan}"
    textColor: "{colors.sheet-white}"
    typography: "{typography.label}"
    padding: "10px 24px"
---

# Design System: Plina Finance

## 1. Overview

**Creative North Star: "The Regulated Terminal"**

A Plina opera no registro visual do terminal financeiro institucional — não o terminal de trader (Bloomberg, neon sobre preto), mas o terminal regulado: hairlines como malha estrutural, mono numérico carregando os dados que importam, tipografia editorial Chillax assinando as âncoras de cada seção, e um único cyan auditável que aparece raramente como sinal — não como decoração. O leitor ideal é a mesa de risco de um family office em Miami às 14h: precisa entender em 30 segundos que isto não é "Renda Fixa Digital" repaginada nem cripto-degen com PR de RWA, e sim um veículo institucional formal sob CVM 175 com clawback nativo.

A profundidade é tonal, não baseada em sombras: alterna `Sheet White` → `Document Grey` → `Deep Petrol` em fatias horizontais que dão ritmo sem decoração. Cards como afordância são raros e nunca aninhados; o padrão dominante é a grid hairline (`gap-px` sobre `bg-hairline`) que separa informação densa sem inventar elevação. Whitespace é generoso: `py-32` é o padrão de seção, `py-40` em capturas de lead. Density alta em conteúdo, low em decoração.

O sistema rejeita explicitamente: gradientes de marca, sombras decorativas, cards iguais com ícone+título+texto, hero-metric template, gradient text, side-stripe borders, e qualquer linguagem de "ganho rápido" ou "renda fixa digital".

**Key Characteristics:**
- Hairlines (1px @ 12% opacity) como única forma de separação estrutural
- Tipografia editorial Chillax para âncoras + Geist Mono para dados
- Auditable Cyan como sinal único, ≤10% de qualquer tela
- Profundidade tonal por sandwich de superfícies (white / grey / petrol)
- Bordas: 0px ou 9999px — nada intermediário
- Easing `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-quart) em todos os estados

## 2. Colors: The Regulated Terminal Palette

Paleta institucional contida — um neutral ladder em três degraus (sheet/grey/petrol) e um único acento de sinal. Reduz pressão cromática para deixar a tipografia e os números trabalharem.

### Primary
- **Auditable Cyan** (`#0EA7C7`): O sinal único do sistema. Aparece em sublinhados ativos, marcadores numerados (`01 //`), ponto final de logotipo (`Plina.`) sobre fundo dark, fill de TopBar, highlights de hover sobre dark, e CTAs em estado hover. Nunca preenche superfícies grandes. Reservado para fundos escuros e fills.
- **Auditable Cyan Deep** (`#057A99`): Variante darken-AA do cyan, ratio 4.91:1 sobre `Sheet White`. Usada para texto/eyebrows/links sobre superfícies claras (`Sheet White` ou `Document Grey`). Mantém a função-sinal sem comprometer WCAG AA. Aparece em todos os eyebrows sobre claro, ponto final de logotipo `PLINA-RF.`, cargo em EquipeSection, link `contato@plina.finance`.

### Secondary
- **Stellar Mid** (`#4A9ED4`): Hover de elementos numéricos pesados (caminhos A/B/C na Tese), transição quando o cyan é forte demais sobre dark.
- **Glacier Tint** (`#A0CFE7`): Hover de títulos editoriais sobre Deep Petrol; única tonalização suave admitida sobre dark.

### Neutral
- **Deep Petrol** (`#132728`): Texto base sobre fundos claros, surface primária da seção institucional dark, cor de body. É a "voz dominante" do sistema — quase tudo é petrol.
- **Document Grey** (`#e4e4e4`): Surface alternada, fill de inputs e chips. Sensação de papel/CMYK uncoated, contraponto claro a sheet white sem virar branco frio.
- **Sheet White** (`#ffffff`): Surface principal de seções claras (Produto, Princípios, captura de lead). Sempre tinted no contexto pelo Deep Petrol que carrega o texto.
- **Hairline** (`rgba(19, 39, 40, 0.12)`): Não é uma cor visível — é a malha estrutural. Toda separação interna (entre items de lista, entre cards de grid) acontece em hairline, nunca em borda colorida.

### Named Rules

**The One Voice Rule.** Auditable Cyan (qualquer variante) aparece em ≤10% de qualquer viewport. Se um wireframe tem cyan em mais de três pontos visíveis, está errado. A força do sinal mora na raridade.

**The Surface-Aware Cyan Rule.** Cyan vibrant `#0EA7C7` é proibido como texto sobre fundos claros (contraste 2.85:1 falha AA). Sobre `Sheet White` ou `Document Grey`, o sinal usa `Auditable Cyan Deep #057A99`. Sobre `Deep Petrol`, o cyan vibrante mantém-se (5.22:1 passa AA).

**The Three-Surface Sandwich.** Toda página alterna entre exatamente três superfícies — `Sheet White`, `Document Grey`, `Deep Petrol`. Nunca um quarto tom. Profundidade vem do contraste de superfície, nunca de sombra.

**The No-Gradient Rule.** Proibido gradient em texto, em background de seção, em borda. O sistema é flat por doutrina. A única exceção tolerada é o radial sutil decorativo na seção Institucional dark, e mesmo ali é quase invisível.

## 3. Typography

**Display Font:** Chillax (sans editorial geométrica, com Satoshi como fallback)
**Body Font:** Satoshi (sans humanista neutra)
**Label Font:** Geist (sans técnica para metadados em uppercase)
**Mono Font:** Geist Mono (números, códigos regulatórios, identificadores SEP/AUTH)

**Character:** Chillax assina as âncoras editoriais com peso 500-600 e leading apertado — é a "voz institucional" do sistema. Satoshi conduz a leitura longa em 300 (light), criando contraste deliberado com o peso do display. Geist Mono é onde os dados moram: durations, mixes-alvo, identificadores técnicos. A pareceria evita o reflexo categoria-fintech (Inter/Söhne em todo lugar) e abraça uma estética mais editorial-financeira.

### Hierarchy
- **Display** (Chillax 600, `clamp(2rem, 5vw, 3.75rem)`, line-height 1.05): Hero H1 e âncoras de seção principais. Letter-spacing apertado em `-0.02em`.
- **Headline** (Chillax 600, `clamp(1.875rem, 3.5vw, 3rem)`, line-height 1.1): Títulos dentro de seções (PLINA-RF, Modelo Híbrido, Infraestrutura Auditável). Acompanhado de um eyebrow label cyan em uppercase.
- **Title** (Chillax 600, `1.5rem`, line-height 1.2): Itens dentro de listas (nomes dos caminhos A/B/C, nomes da equipe, valores em Stack tiles).
- **Body** (Satoshi 300, `1.125rem`–`1.25rem`, line-height 1.6): Copy institucional. Cap em ~65–75ch. Light weight é deliberado — cria respiração e contraste com Chillax.
- **Label** (Geist 700, `0.625rem`, letter-spacing `0.2em`–`0.3em`, UPPERCASE): Eyebrows, metadados, CTAs, tags em footer. Uppercase é regra para todo label.
- **Mono** (Geist Mono 400-500, `0.75rem`–`0.875rem`, letter-spacing `0.05em`): Numerais (`01 //`, `40-60%`, `30-90 dias`), nomes de SEPs (`SEP-24`), identificadores técnicos (`AUTH_CLAWBACK_ENABLED`), endereço de contato (`contato@plina.finance`).

### Named Rules

**The Mono-For-Data Rule.** Qualquer número que carregue significado regulatório, financeiro ou técnico aparece em Geist Mono. Percentuais de mix-alvo, durations, identificadores SEP, hash on-chain, AUM thresholds — tudo mono. Nunca Satoshi. Esta é a assinatura visual do sistema.

**The Light-Body Rule.** Body copy em Satoshi 300 (light). Pesos 400+ em copy longo viram leitura "pesada de SaaS". O sistema respira porque o body é leve e o display é médio-pesado.

**The Eyebrow-Headline Pair.** Toda seção principal abre com um label cyan uppercase (`tracking-widest`) seguido imediatamente do display em Chillax. Nunca display sozinho em topo de seção.

## 4. Elevation

Sistema **flat-by-doctrine**. Profundidade vem de três mecanismos, todos sem sombra:

1. **Tonal sandwich**: alternância entre Sheet White / Document Grey / Deep Petrol entre seções verticais.
2. **Hairlines**: separação de informação interna sempre em `1px rgba(19,39,40,0.12)` sobre claro, ou `1px rgba(255,255,255,0.1)` sobre dark.
3. **Color reveal on hover**: barras de 1×100% à esquerda em `auditable-cyan` que escalam de `scale-y-0` a `scale-y-100` em hover de items de lista — toda a animação é vertical, não há translate-y, não há shadow-spread.

### Named Rules

**The Flat-By-Default Rule.** Surfaces não têm sombra em rest. Drop shadows são proibidos, exceto no caso único do CTA primário (botão `Solicitar Documentação Confidencial` em Lead Capture), que usa `shadow-xl` com cor refletida em hover (`shadow-primary/20`) para sugerir o estado de ação.

**The No-Glassmorphism Rule.** A única instância tolerada de `backdrop-blur` é a navbar quando passa do hero — para legibilidade do texto sobre conteúdo dinâmico abaixo. `glass-blur` e `glass-ribs` definidos em `globals.css` não aparecem em produção; se forem usados, é só em décor de hero, nunca em cards de conteúdo.

## 5. Components

### Buttons

**Character:** Pílula full-radius (`rounded-full`) com letter-spacing wide e label uppercase em Geist 700. Sensação de botão de gerenciador de patrimônio, não de SaaS landing.

- **Shape:** `9999px` (rounded-full).
- **Primary** (`bg-deep-petrol text-sheet-white`, padding `20px 40px`): CTA institucional principal — Lead Capture, Solicitar Prospecto. Hover transita para `bg-auditable-cyan` com `transition-all`.
- **Ghost** (`bg-sheet-white text-deep-petrol`, padding `10px 20px`): CTA secundário no header navbar (Solicitar Prospecto). Hover suaviza para `#e4e4e4`.
- **Hover transition:** `cubic-bezier(0.16, 1, 0.3, 1)`, 300ms. Sem scale, sem translateY exceto na barra cyan lateral em items de lista.

### Chips

- **Style:** `bg-document-grey text-deep-petrol/60` (Tese tags antigos), label Geist 700 em `0.625rem`, uppercase com `tracking-widest`. Borda hairline.
- **Padding:** `8px 16px`. Pílula full-radius.
- **Não usar** chips para navegação ou seleção. Apenas para metadados secundários ("Fluxo B2B Integrado", "CVM 175 Compliant").

### Cards / Tiles

- **Corner Style:** `0px` (sharp). Cards não têm radius. Esta é doutrina contra a estética SaaS.
- **Background:** `Sheet White` sobre `Document Grey` (Stack, Produto), separados por `gap-px` que revela hairline embaixo.
- **Shadow Strategy:** Nenhuma. Profundidade é puramente tonal.
- **Border:** Hairline externo opcional; separação interna via `gap-px` sobre `bg-hairline`.
- **Internal Padding:** `32px` (`p-8`).
- **Hover:** transição de fill (`bg-sheet-white` → `bg-document-grey/40`) em 500ms; sem translate, sem scale.

### Inputs / Fields

- **Style:** `rounded-full` (`9999px`), padding `16px 28px`, border `1px` em `gray-200`, fill `bg-document-grey/20`.
- **Typography:** Satoshi 400 ou 300, `1rem`.
- **Label:** acima do input, em Geist 700 `0.625rem` uppercase tracking-widest, com leading-margin `ml-4`.
- **Focus:** `border-color` muda para `auditable-cyan`, sem outline, sem glow. Discreto.
- **Disabled / Error:** não documentados (a landing não tem fluxos de erro inline em estado atual).

### Navigation

- **Site Header:** combina TopBar de anúncio (`bg-auditable-cyan`, label uppercase) + navbar transparente sobre hero, transitando para `bg-deep-petrol/95 backdrop-blur-md` quando passa do hero.
- **Typography:** label Geist em `0.6875rem` (`text-[11px]`), `tracking-widest`, uppercase.
- **States:** opacity `text-white/80` em rest, `text-white` em hover. Sem underline, sem border-bottom.
- **Mobile:** hamburger (Lucide `Menu`) + drawer fullbleed em `bg-deep-petrol`, label em `text-sm`.

### Hero

- **Background:** `bg-deep-petrol` + `hero-fractal.svg` em `cover`, `no-repeat`. Decoração visual pesada concentrada aqui — nas demais seções, surfaces são lisas.
- **Animation:** `hero-fade-up` em texto principal (`1.8s cubic-bezier(0.16, 1, 0.3, 1)`, delay 300ms) + scroll indicator com delay 1.2s.
- **Subtitle pattern:** label Geist em `tracking-[0.3em]` separa descritor regulatório (`Tokenizadora Institucional · FIDC sob CVM 175 · Stellar`) abaixo do H1.

### Numbered List Item (signature pattern)

Padrão recorrente em PrincipiosSection, TeseSection, EquipeSection:
- Numeral mono (`01`, `02`, `A`, `B`) em peso light, cor `text-deep-petrol/20` em rest, transitando para `auditable-cyan` em hover do grupo
- Barra absolute esquerda 1×100% em `auditable-cyan`, `scale-y-0` → `scale-y-100` em group-hover, origin-top, 700ms
- Hairline divisor `border-b border-hairline` entre items
- Padding vertical `py-16`

Esta é **a assinatura visual do sistema**. Reuse antes de inventar layouts novos.

## 6. Do's and Don'ts

### Do:
- **Do** usar Auditable Cyan (`#0EA7C7`) como sinal raro — sublinhados ativos, ponto do logotipo, hover de barra lateral, eyebrow label uppercase. Máximo 10% de qualquer tela.
- **Do** alternar superfícies em sandwich `Sheet White` → `Document Grey` → `Deep Petrol` entre seções verticais.
- **Do** usar Geist Mono para todo número que carregue significado (mix-alvo, duration, percentual, identificador SEP/AUTH, endereço de contato).
- **Do** parear toda âncora de seção: eyebrow Geist 700 uppercase tracking-widest cyan + Chillax display. Nunca display sozinho.
- **Do** separar informação interna com hairlines `1px rgba(19,39,40,0.12)` ou `gap-px` sobre `bg-hairline`. Nunca borda colorida.
- **Do** usar barras laterais animadas (1×100%, scale-y origin-top, 700ms cyan) para sinalizar hover em list items numerados.
- **Do** manter body em Satoshi 300 (light). Pesos pesados em copy longo são proibidos.
- **Do** citar enquadramento regulatório explícito (CVM 175, Lei 11.795/2008, AUTH_CLAWBACK_ENABLED, SEP-24) em destaque editorial — não em fineprint de rodapé.

### Don't:
- **Don't** usar gradient em texto (`background-clip: text`), em background de seção, ou em borda. Gradient é proibido.
- **Don't** usar drop shadows decorativas. Cards são flat. Profundidade é tonal.
- **Don't** usar `border-left` ou `border-right` maior que 1px como side-stripe colorida em cards, alerts, callouts. A barra lateral cyan é animada por scale em hover, não estática em rest.
- **Don't** clonar o template hero-metric (big number + label + supporting stats + gradient accent). É o cliché SaaS que o sistema rejeita.
- **Don't** fazer cards iguais com ícone + heading + texto repetidos. Se há repetição estrutural, use o padrão de numbered list item, não card grid genérico.
- **Don't** usar glassmorphism em cards de conteúdo. Backdrop-blur só na navbar pós-hero.
- **Don't** usar copy de "Renda Fixa Digital", "ganho rápido", "rentabilidade garantida", ou qualquer linguagem do framing Mercado Bitcoin / fintech retail brasileira (Nubank, Inter, C6).
- **Don't** simplificar termos técnicos. CVM 175, FIDC, AUTH_CLAWBACK_ENABLED, SEP-38 aparecem como ferramentas de trabalho. Quem não entende não é o público.
- **Don't** usar emoji, exclamação, ou imperativo agressivo em CTA. Registro consultivo: "Solicitar Prospecto", "Submeter Aplicação", "Agendar Roadshow".
- **Don't** usar em-dash (—) em código ou em copy nova; usar vírgula, dois-pontos ou ponto. (Exceção: copy já produzido no PDF/brand guidelines mantém o estilo original.)
- **Don't** introduzir uma quarta superfície de cor (azul claro, off-white, etc). Sandwich é três tons exatos.
