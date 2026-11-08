# UNK

Aplicacao web UNK para compartilhar telas com todas as pessoas de uma sala, sem cadastro, extensao ou instalacao. A captura usa `getDisplayMedia()`, a midia trafega por WebRTC e o servidor cria salas temporarias e encaminha a sinalizacao por Socket.IO. A rota WebSocket original continua disponivel para compatibilidade.

O logo e favicon usam um quadro da marca extraido do video original e otimizado para navegadores como PNG transparente de 256 × 256 pixels. O arquivo MOV, cujo codec nao e amplamente reproduzido na web, nao e carregado pelos visitantes.

A interface usa a paleta Dark Luxury: preto profundo, grafite, cinza, prata e branco, com superficies discretas e espaco visual amplo.

## Executar localmente

Requer Node.js 20 ou superior.

```sh
npm install
npm start
```

Abra `http://localhost:3000` no Chrome, Edge, Brave ou Firefox. Em `localhost`, os navegadores permitem captura de tela sem HTTPS. Clique em **Criar uma sala**, informe seu nome e copie o link de convite para abrir em outros navegadores ou computadores. Cada sala aceita ate cinco pessoas, incluindo o anfitriao; a proxima tentativa recebe a mensagem **Sala esta cheia**. Qualquer participante pode iniciar a captura; ate duas pessoas podem reservar transmissao ao mesmo tempo, sem depender de quem entrou primeiro ou de ser anfitriao. Cada pessoa cria uma conexao WebRTC com todos os outros participantes, entao quem entra depois tambem recebe as telas que ja estao sendo transmitidas. Uma sala cheia exige ate quatro conexoes por participante; as duas transmissoes simultaneas sao enviadas diretamente aos demais pela malha WebRTC. Essa topologia usa mais banda e processamento conforme mais participantes e telas sao adicionados. Na sala, **Sinalizacao conectada** significa que a sala esta acessivel, nao que a tela ja esta sendo enviada: o estado **Envio confirmado** aparece quando novas imagens sao codificadas pelo WebRTC, e **AO VIVO** quando os quadros recebidos podem ser exibidos.

No PowerShell do Windows, use `npm.cmd` para evitar o bloqueio de scripts `.ps1` da politica de execucao:

```powershell
npm.cmd install
npm.cmd test
npm.cmd start
```

Se o terminal nao encontrar `node` ou `npm.cmd`, feche e reabra o VS Code para carregar o PATH atualizado.

## Publicar online (Render + Cloudflare Pages)

O Render hospeda o backend Node.js, salas e sinalizacao; o Cloudflare Pages hospeda os arquivos estaticos. O video continua ponto a ponto por WebRTC. O aplicativo nao exige conta dos participantes, instalacao ou extensao.

### Requisitos e variaveis

- Node.js 20 ou superior (declarado em `package.json`).
- Uma conta Render ligada ao repositorio e uma conta Cloudflare ligada ao GitHub.
- HTTPS na origem do Pages e na origem do backend. Em producao, o servidor recusa HTTP.
- O dominio publico do Pages e o dominio HTTPS atribuido ao servico web do Render.

| Variavel | Plataforma | Obrigatoria | Valor |
| --- | --- | --- | --- |
| `PUBLIC_APP_ORIGINS` | Render | Sim para o Pages acessar o backend | Origem exata do Pages, por exemplo `https://unk-screen-share.pages.dev`, sem caminho nem barra final. Multiplas origens podem ser separadas por virgula. |
| `TURN_URL` | Render | Nao | URLs `turn:`/`turns:` fornecidas pelo servico TURN escolhido, separadas por virgula. |
| `TURN_SHARED_SECRET` | Render | Nao, exceto quando `TURN_URL` e definido | Segredo fornecido pela configuracao do servidor TURN. Nunca o publique ou coloque no Pages. |
| `TURN_CREDENTIAL_TTL` | Render | Nao | Validade das credenciais em segundos; padrao 3600, permitido de 300 a 86400. |
| `UNK_API_BASE_URL` | Cloudflare Pages | Sim | Origem HTTPS do servico Render, por exemplo `https://unk-screen-share.onrender.com`. Nao adicione caminho, token ou segredo. |

`TURN_URL` e `TURN_SHARED_SECRET` precisam ser definidos juntos ou deixados ambos vazios. Sem TURN, o backend fornece STUN por padrao. TURN e um servico separado: hospedar no Render nao cria nem garante um servidor TURN compativel. Nao ha credenciais ou servidor TURN gratuito embutidos neste projeto.

### Passo a passo de publicacao

1. **Criar o backend no Render.** No painel Render, crie um Blueprint a partir de `Thiag0Wm/UNK-Compartilhamento-de-tela` e use o `render.yaml` do repositorio. O servico usa runtime Node, `npm ci`, `npm start` e o health check `/api/health`; a versao minima de Node vem de `package.json`. O Render fornece a variavel `PORT`. Deixe `TURN_URL` e `TURN_SHARED_SECRET` vazios inicialmente e mantenha `TURN_CREDENTIAL_TTL` em `3600`.
2. **Preencher `PUBLIC_APP_ORIGINS`.** Ao criar o servico, o endereco Pages talvez ainda nao exista. Use temporariamente uma origem que nao seja um site real, como `https://placeholder.invalid`, para que nenhuma origem desconhecida seja autorizada. Depois que o Pages estiver criado, substitua esse valor pela origem Pages exata. Nao use `*`.
3. **Verificar o backend.** Aguarde o deploy e abra `https://<servico>.onrender.com/api/health`. A resposta esperada e `{"status":"ok"}`. Guarde apenas a origem `https://<servico>.onrender.com`, sem `/api/health`.
4. **Criar o projeto Pages.** No Cloudflare Pages, conecte o mesmo repositorio e branch de producao. Configure o comando de build como `npm ci && npm run build` e o diretorio de saida como `public`. Em **Settings > Variables and Secrets**, crie `UNK_API_BASE_URL` como variavel de build de producao e defina a origem HTTPS do Render.
5. **Publicar e autorizar a origem.** Aguarde o primeiro deploy do Pages e copie a origem atribuida, por exemplo `https://<projeto>.pages.dev`. No Render, altere `PUBLIC_APP_ORIGINS` para essa origem exata e salve/republique o backend. Se for usar dominios customizados ou deploy previews, inclua cada origem explicitamente; o CORS nao libera previews automaticamente.
6. **Validar os dois servicos.** Abra o Pages, crie uma sala e confirme que o pedido `POST /api/rooms` retorna HTTP 201 e que a conexao Socket.IO permanece conectada. Depois teste a transmissao real entre dois navegadores/dispositivos seguindo a secao de diagnostico.

O build gera `public/config.js` com `UNK_API_BASE_URL`, copia o cliente Socket.IO para `public/socket.io-client.js` e restringe `connect-src` no CSP do Pages a origem HTTPS e ao endpoint WSS correspondente. Quando a variavel estiver vazia, a configuracao gerada tambem fica vazia e a aplicacao usa a propria origem, mantendo a execucao local. O build rejeita URLs remotas HTTP e URLs com credenciais, caminho ou query string.

### Configuracao do Render e limites de disponibilidade

`render.yaml` cria um unico servico web gratuito, sem configurar escalabilidade horizontal. As salas, tokens e sinalizacao ficam na memoria desse unico processo; mantenha **uma instancia**. Reiniciar ou suspender o processo elimina salas ativas. O plano gratuito do Render pode suspender servicos inativos e provocar atraso de inicializacao, e seus limites/disponibilidade podem mudar. Isso nao equivale a uma sessao sempre ativa nem a armazenamento duravel.

Salas sem participantes expiram apos duas horas; a atividade de participantes atualiza a expiracao. Mesmo dentro desse prazo, uma suspensao ou reinicializacao do processo pode encerrar a sala. Multiplas instancias exigiriam armazenamento compartilhado para salas e um transporte pub/sub para sinalizacao, que este projeto nao configura.

### Atualizar a aplicacao

Envie as alteracoes para o branch conectado ao Render e ao Pages. O Render recompila e inicia o backend; o Pages roda `npm ci && npm run build` e publica `public`. Se o endereco do backend mudar, atualize `UNK_API_BASE_URL` no Pages e inicie um novo deploy. Se o dominio do Pages mudar, atualize `PUBLIC_APP_ORIGINS` no Render. Alteracoes em variaveis de build do Pages so aparecem em um novo build.

### Diagnostico rapido (Windows/PowerShell)

```powershell
# Confirme o backend e a resposta JSON
Invoke-RestMethod "https://<servico>.onrender.com/api/health"

# Confirme que uma origem nao permitida e recusada (esperado: HTTP 403)
Invoke-WebRequest "https://<servico>.onrender.com/api/rooms" `
  -Method Post `
  -Headers @{ Origin = "https://origem-nao-autorizada.example" }
```

Para diagnosticar pelo navegador:

- Em **DevTools > Network**, confirme que `POST /api/rooms` e `GET /api/ice` usam a origem Render e nao falham com CORS. A criacao de sala deve retornar HTTP 201.
- Confirme a conexao Socket.IO na aba Network (WebSocket ou polling) e procure erros de CORS/403 no console. Em producao, a pagina HTTPS deve conectar ao backend com HTTPS/WSS.
- Se a sala abrir mas nao conectar, confirme que `PUBLIC_APP_ORIGINS` corresponde exatamente a origem Pages, sem barra final, e que o servico Render terminou de iniciar. No plano gratuito, aguarde a inicializacao a frio e tente novamente.
- Sem TURN, algumas redes corporativas, VPNs e roteadores podem impedir WebRTC mesmo que a sinalizacao Socket.IO esteja conectada. Configure um servidor TURN externo e suas credenciais no Render para essas redes.
- Se uma sala parar de funcionar apos deploy, suspensao ou reinicializacao do Render, crie outra sala: os dados em memoria nao sobrevivem ao processo.
- Nao interprete “Sinalizacao conectada” como prova de video. A confirmacao de envio/recepcao e o estado ao vivo dependem de quadros e estatisticas WebRTC reais.

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
- O link de convite permite entrar como visitante; o link privado de anfitriao continua protegido e nao e copiado pelo botao de convite. Todos os participantes podem iniciar e encerrar o proprio compartilhamento. As telas recebidas aparecem em destaque e em miniaturas adicionais; a previa local permanece no canto.
- Ao abrir um link de sala, cada participante informa um nome (ate 32 caracteres); a lista mostra os participantes conectados no momento.
- Cada sala admite no maximo cinco conexoes (anfitriao + quatro visitantes), controladas no servidor. No maximo dois participantes podem reservar transmissao simultanea. Cada participante negocia com todos os demais; transmissores ativos enviam sua tela a cada conexao, inclusive a participantes que entrarem depois.
- A primeira tela recebida aparece em destaque e outras telas aparecem em miniaturas; a pre-visualizacao local fica no canto. A indicacao de envio muda para confirmada depois que novas imagens aparecem nas estatisticas WebRTC; o indicador ao vivo aparece quando o video recebido realmente comeca a tocar.
- A pessoa que transmite confirma quadros codificados (saida WebRTC); a pessoa que recebe confirma quadros decodificados (entrada) e um quadro de video pronto para exibicao. As estatisticas exibidas correspondem a uma conexao WebRTC selecionada e real; a falta de novos quadros em um unico intervalo nao encerra o estado ao vivo.
- A conexao de midia e ponto a ponto com WebRTC; TURN pode retransmitir midia quando necessario.
- Em producao, HTTPS e obrigatorio para captura de tela, Socket.IO seguro e WebSocket seguro.

## Validacao

Instale dependencias e execute os testes no Windows/PowerShell com:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
```

Os testes verificam a criacao de salas, a entrega da aplicacao, a autenticacao de anfitriao, o limite de cinco participantes e a liberacao de vagas, sinalizacao Socket.IO nos dois sentidos, CORS para Pages, compatibilidade da rota WebSocket existente, calculos de metricas e ajuste automatico de qualidade, e validacao da URL do backend no build.

Os testes automatizados nao simulam os seletores de compartilhamento nem substituem testes reais de Chrome, Edge, Brave e Firefox. Antes de anunciar suporte validado, teste os pares Chrome/Firefox e Brave/Edge em dois dispositivos e redes diferentes, incluindo audio quando oferecido, perda e reconexao, FPS, resolucao, tela cheia e uma sessao prolongada. Esses testes exigem navegadores e dispositivos reais; o servidor de desenvolvimento sozinho nao confirma compatibilidade, desempenho 4K/60 FPS nem conectividade TURN.

### Teste de transmissao real

1. Abra a URL HTTPS do Pages em dois dispositivos/navegadores suportados e em redes diferentes, se possivel.
2. No primeiro navegador, crie uma sala, informe o nome e envie o link de convite ao segundo. Ambos devem aparecer na lista de participantes. A sala aceita ate cinco pessoas; teste tambem a rejeicao de uma sexta pessoa e a liberacao de uma vaga quando alguem sai.
3. Clique em **Compartilhar tela** em um dos dispositivos e autorize a captura no seletor nativo do navegador. Confirme a imagem remota, o estado ao vivo e as estatisticas WebRTC; nao use apenas o indicador de conexao Socket.IO como evidencia.
4. Em uma sala com ate cinco pessoas, teste uma transmissao iniciada por visitantes que nao sejam o primeiro a entrar; confirme que qualquer par de duas pessoas consegue transmitir e ver a tela da outra. Tente uma terceira transmissao simultanea e confirme a mensagem de limite; pare uma tela e tente novamente para verificar a liberacao da vaga.
5. Se o teste entre redes falhar, repita em redes sem VPN/firewall ou configure um servico TURN externo. Teste audio somente quando o navegador e o sistema operacional oferecerem a faixa.

Os testes automatizados nao comprovam que uma transmissao de producao funciona em dispositivos, navegadores ou redes reais. Este repositorio nao foi implantado nem testado em uma conta Render/Cloudflare por esses testes locais.
