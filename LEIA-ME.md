# Editor Hinos — 16:9 e 9:16 (versão única)

Um só app, na pasta `unico/` do MESMO repositório (reaproveita `vendor/` com o FFmpeg.wasm).

## Como usar
No topo, escolha o formato. Cada um já abre com as pré-edições prontas
(o app lembra o que você alterar em cada formato; "↺ Restaurar padrão" volta ao original):

**16:9 · Violão** (YouTube)
- Parte 1 = tablatura (metade de cima); Parte 2 = violão (metade de baixo), unidas em sequência
- Violão com cantos arredondados sobre fundo preto
- CTAs embaixo ("Inscreva-se", "Compartilhe", "Curta"), por parte
- Título e texto final desligados (pode ligar)

**9:16 · Vertical** (TikTok/Reels/Shorts)
- Fundo desfocado com as cores do vídeo + vídeo central com cantos arredondados
- Título "Hino N / Instrumento" nos primeiros segundos
- CTAs no centro da tela e texto final "Quer tocar este hino? Baixe o aplicativo no link da Bio!"

## Publicar pelo Android
1. No repositório: **Add file → Create new file**, nome `unico/LEIA-ME.md`, qualquer texto, **Commit** (cria a pasta).
2. Abra a pasta `unico` → **Add file → Upload files** → envie: `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.json`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` → **Commit changes**.
3. Acesse `SEU-LINK/unico/` e instale pelo botão **Instalar App (PWA)**.

Requisito: a pasta `vendor/` precisa existir na raiz do repositório (já existe).
