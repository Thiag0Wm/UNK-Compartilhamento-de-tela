# UNK

Aplicacao web UNK para compartilhar uma tela com outra pessoa, sem cadastro, extensao ou instalacao. A captura usa `getDisplayMedia()`, a midia trafega por WebRTC e o servidor cria salas temporarias e encaminha a sinalizacao por Socket.IO. A rota WebSocket original continua disponivel para compatibilidade.

O logo e favicon usam um quadro da marca extraido do video original e otimizado para navegadores como PNG transparente de 256 × 256 pixels. O arquivo MOV, cujo codec nao e amplamente reproduzido na web, nao e carregado pelos visitantes.

A interface usa a paleta Dark Luxury: preto profundo, grafite, cinza, prata e branco, com superficies discretas e espaco visual amplo.

## Executar localmente

Requer Node.js 20 ou superior.

```sh
npm install
npm start
```

Abra `http://localhost:3000` no Chrome, Edge, Brave ou Firefox. Em `localhost`, os navegadores permitem captura de tela sem HTTPS. Clique em **Criar uma sala**, informe seu nome e copie o link de convite para abrir em outro navegador ou computador. Qualquer uma das duas pessoas pode clicar em **Compartilhar tela** e escolher uma janela/tela. Na sala, **Sinalizacao conectada** significa que a sala esta acessivel, nao que a tela ja esta sendo enviada: o estado **Envio confirmado** aparece quando novas imagens sao codificadas pelo WebRTC, e **AO VIVO** quando os quadros recebidos podem ser exibidos.

No PowerShell do Windows, use `npm.cmd` para evitar o bloqueio de scripts `.ps1` da politica de execucao:

```powershell
npm.cmd install
npm.cmd test
npm.cmd start
```

Se o terminal nao encontrar `node` ou `npm.cmd`, feche e reabra o VS Code para carregar o PATH atualizado.

## Publicar online

O backend requer Node.js, Socket.IO e memoria de processo para manter as salas; Cloudflare Pages sozinho nao pode hospedar esse servidor. Use Cloudflare Pages para os arquivos estaticos e Render para o backend:

1. No Render, crie um Blueprint a partir deste repositorio. O arquivo `render.yaml` configura o servico Node e o health check. Anote o endereco HTTPS atribuido ao servico.
2. No Cloudflare Pages, conecte o mesmo repositorio, use `npm ci && npm run build` como comando de build e `public` como diretorio de saida. Defina `UNK_API_BASE_URL` com a origem HTTPS do servico Render, por exemplo `https://unk-screen-share.onrender.com`.
3. Configure `PUBLIC_APP_ORIGINS` no servico Render com a origem exata do site Pages, como `https://unk-screen-share.pages.dev`. O backend aceita APIs e Socket.IO somente dessa origem e da propria origem do servidor.
4. Configure `TURN_URL` e `TURN_SHARED_SECRET` no Render para oferecer TURN em redes restritivas. O servidor rejeita requisicoes HTTP em producao; use os enderecos HTTPS.

O build copia o cliente Socket.IO para `public` e grava a origem configurada em `public/config.js`; localmente, uma origem vazia usa o proprio servidor.

Salas e sinalizacao ficam na memoria do processo e expiram depois de duas horas sem participantes. Mantenha uma unica instancia do servico: o uso de multiplas instancias exige um armazenamento compartilhado e um transporte de sinalizacao pub/sub.

### TURN para redes restritivas

STUN publico esta habilitado por padrao. Para redes que bloqueiam conexoes diretas, configure `TURN_URL` e `TURN_SHARED_SECRET` no ambiente do servico. O servidor emite credenciais TURN temporarias compativeis com autenticacao REST do coturn (`--use-auth-secret`). `TURN_URL` aceita uma lista separada por virgulas, por exemplo `turn:turn.exemplo.com:3478?transport=udp,turns:turn.exemplo.com:5349?transport=tcp`. Guarde o segredo apenas no servidor; nunca o inclua no codigo ou no navegador. Ajuste opcionalmente `TURN_CREDENTIAL_TTL` (300 a 86400 segundos).

Sem um servidor TURN configurado, algumas combinacoes de roteadores, firewalls e redes corporativas podem impedir a conexao; STUN sozinho nao garante conectividade em todas as redes.

## Qualidade, compatibilidade e privacidade

- Perfis permitem escolher resolucao de ate 720p, 1080p, 1440p ou 4K e limite desejado de 30 ou 60 FPS. Esses valores sao limites pretendidos, nao garantias: o navegador, a captura escolhida, a tela, o dispositivo e a rede determinam a resolucao, os quadros e o codec efetivos.
- Soria e usada como tipografia de destaque quando estiver instalada no sistema, com Georgia como alternativa. A Soria citada pela Figma nao esta no Google Fonts e nao foi encontrado um arquivo de fonte com licenca de incorporacao; para garantir a mesma tipografia em todos os dispositivos, forneca um arquivo webfont autorizado (.woff2) e a respectiva licenca.
- A qualidade automatica usa `RTCPeerConnection.getStats()` para reduzir gradualmente o teto de bitrate, resolucao e FPS durante congestionamento e restaurar o perfil quando a conexao se recupera. No modo manual, o controle de congestionamento WebRTC do proprio navegador continua ativo.
- O painel exibe somente estatisticas reais reportadas pelo WebRTC: dimensoes recebidas/enviadas, FPS medido, bitrate, RTT, perda de pacotes, codec e tipo ICE quando disponibilizados pela implementacao. Metricas indisponiveis aparecem como `—`.
- As preferencias de codec sao aplicadas apenas quando a API padronizada de negociacao do navegador esta disponivel; caso contrario, a negociacao nativa entre os participantes e mantida. A aceleracao de hardware tambem fica sob controle do navegador e do sistema operacional: nao existe uma API web interoperavel para forca-la ou prometer sua disponibilidade.
- O audio da tela e opcional. O navegador pode nao fornecer uma faixa de audio, dependendo do navegador, sistema e origem capturada. O visitante pode ativar ou silenciar o audio recebido.
- Tela cheia, exibicao de estatisticas, parametros do transmissor, captura e codecs sao verificados por funcionalidade; o nome do navegador e informativo e nao determina o fluxo.
- Chrome, Microsoft Edge, Brave e Firefox atuais; Windows, macOS e Linux, sujeitos as permissoes e capacidades de captura de cada navegador e sistema.
- O link de convite permite entrar como visitante; o link privado de anfitriao continua protegido e nao e copiado pelo botao de convite. Qualquer uma das duas pessoas conectadas pode iniciar e encerrar o proprio compartilhamento. Se ambas compartilharem, a tela recebida aparece em destaque e a previa local no canto.
- Ao abrir um link de sala, cada participante informa um nome (ate 32 caracteres); a lista mostra os participantes conectados no momento.
- A tela recebida aparece em destaque e a pre-visualizacao local no canto. A indicacao de envio muda para confirmada depois que novas imagens aparecem nas estatisticas WebRTC; o indicador ao vivo aparece quando o video recebido realmente comeca a tocar.
- A pessoa que transmite confirma quadros codificados (saida WebRTC); a outra pessoa confirma quadros decodificados (entrada) e um quadro de video pronto para exibicao. A falta de novos quadros em um unico intervalo de estatisticas nao encerra o estado ao vivo.
- A conexao de midia e ponto a ponto com WebRTC; TURN pode retransmitir midia quando necessario.
- Em producao, HTTPS e obrigatorio para captura de tela, Socket.IO seguro e WebSocket seguro.

## Validacao

Execute `npm test` para verificar a criacao de salas, a entrega da aplicacao, a autenticacao de anfitriao, a sinalizacao por Socket.IO, a compatibilidade da rota WebSocket existente e os calculos de metricas e ajuste automatico de qualidade.

Os testes automatizados nao simulam os seletores de compartilhamento nem substituem testes reais de Chrome, Edge, Brave e Firefox. Antes de anunciar suporte validado, teste os pares Chrome/Firefox e Brave/Edge em dois dispositivos e redes diferentes, incluindo audio quando oferecido, perda e reconexao, FPS, resolucao, tela cheia e uma sessao prolongada. Esses testes exigem navegadores e dispositivos reais; o servidor de desenvolvimento sozinho nao confirma compatibilidade, desempenho 4K/60 FPS nem conectividade TURN.
