# Alerta de Gol para Sofascore

Extensão para o Chrome que mostra notificações do Windows sobre os jogos dos seus favoritos no [Sofascore](https://www.sofascore.com). Projeto pessoal, sem vínculo com o Sofascore.

## O que ela avisa

| Esporte | Aviso |
|---|---|
| Futebol, futsal e minifutebol | Início, gol, gol anulado, pênalti marcado, cancelado, perdido e convertido, fim do 1º tempo, início do 2º tempo, prorrogação, disputa de pênaltis, cada pênalti convertido na disputa e fim |
| Esports | Início, início de cada mapa, mapa vencido, placar corrigido e fim |
| Basquete | Início, fim de cada quarto e fim |

Valem os jogos da sua aba Favoritos: com estrela, dos seus times e das suas ligas.

## Como instalar

1. Baixe este repositório.
2. Abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta `alerta-gol-sofascore`.
4. Abra ou recarregue uma aba do Sofascore.
5. No ícone da extensão, clique em **Testar notificação**.

Se o aviso de teste não aparecer, confira se o Google Chrome está liberado em **Configurações > Sistema > Notificações**, no Windows.

## Como funciona

A extensão lê os favoritos e os placares que o próprio site grava no navegador. Os lances de pênalti não ficam gravados, então, pela aba aberta, ela consulta os lances dos jogos de futebol ao vivo, no máximo uma vez por minuto por jogo. Se o site recusar, essas consultas pausam por 5 a 60 minutos, e os demais avisos continuam. Por isso:

- **Precisa de uma aba do Sofascore aberta**, que pode ficar em segundo plano.
- O aviso pode levar 1 a 2 minutos depois do lance.
- O pênalti marcado depende de o site registrar esse lance. Se não registrar, o aviso só sai quando o pênalti é convertido ou perdido.
- Nos 2 primeiros minutos depois de a aba carregar, o site ainda mostra placares antigos, e a extensão não avisa.
- O botão **Pausar alertas** suspende os avisos. Ao retomar, o que aconteceu na pausa não gera notificação.

## Testes

Precisa de [Node.js](https://nodejs.org):

```bash
node --test test/
```
