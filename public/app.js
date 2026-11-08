const landing = document.querySelector("#landing");
const roomView = document.querySelector("#room");
const roomGrid = document.querySelector("#room-grid");
const nameEntry = document.querySelector("#name-entry");
const roomNameInput = document.querySelector("#room-name");
const nameMessage = document.querySelector("#name-message");
const participantsList = document.querySelector("#participants-list");
const participantsCount = document.querySelector("#participants-count");
const createRoomButton = document.querySelector("#create-room");
const landingMessage = document.querySelector("#landing-message");
const inviteLink = document.querySelector("#invite-link");
const copyButton = document.querySelector("#copy-link");
const copyMessage = document.querySelector("#copy-message");
const connectionStatus = document.querySelector("#connection-status");
const statusText = connectionStatus.querySelector("span:last-child");
const remoteVideo = document.querySelector("#remote-video");
const localPreview = document.querySelector("#local-preview");
const videoFrame = document.querySelector(".video-frame");
const videoPlaceholder = document.querySelector("#video-placeholder");
const playVideoButton = document.querySelector("#play-video");
const placeholderTitle = document.querySelector("#placeholder-title");
const placeholderDescription = document.querySelector("#placeholder-description");
const liveLabel = document.querySelector("#live-label");
const liveText = document.querySelector("#live-text");
const transmissionStatus = document.querySelector("#transmission-status");
const shareButton = document.querySelector("#share-screen");
const shareMessage = document.querySelector("#share-message");
const roomTitle = document.querySelector("#room-title");
const roomDescription = document.querySelector("#room-description");
const roomEyebrow = document.querySelector("#room-eyebrow");
const audioCapture = document.querySelector("#capture-audio");
const audioToggle = document.querySelector("#audio-toggle");
const fullscreenToggle = document.querySelector("#fullscreen-toggle");
const qualityModeButton = document.querySelector("#quality-mode");
const qualityModeState = document.querySelector("#quality-mode-state");
const qualityResolution = document.querySelector("#quality-resolution");
const qualityFps = document.querySelector("#quality-fps");
const compatibilityMessage = document.querySelector("#compatibility-message");
const qualityWarning = document.querySelector("#quality-warning");
const connectionGrade = document.querySelector("#connection-grade");
const transportType = document.querySelector("#transport-type");
const metricResolution = document.querySelector("#metric-resolution");
const metricFps = document.querySelector("#metric-fps");
const metricBitrate = document.querySelector("#metric-bitrate");
const metricLatency = document.querySelector("#metric-latency");
const metricPacketLoss = document.querySelector("#metric-packet-loss");
const metricCodec = document.querySelector("#metric-codec");
const metricTransport = document.querySelector("#metric-transport");
const metricState = document.querySelector("#metric-state");
const apiBaseUrl = new URL(window.UNK_API_BASE_URL || window.location.origin).origin;

let role = null;
let roomId = null;
let participantName = "";
let remoteParticipantName = "";
let hostToken = null;
let socket = null;
let peerConnection = null;
let screenStream = null;
let peerIsReady = false;
let iceServers = [];
let statsTimer = null;
let statsSample = null;
let statsRequestPending = false;
let pendingCandidates = [];
let playbackBlocked = false;
let signalQueue = Promise.resolve();
let qualityApplyQueue = Promise.resolve();
let makingOffer = false;
let negotiationPending = false;
let ignoreOffer = false;
let settingRemoteAnswerPending = false;
let selectedProfile = window.TelaQuality.makeProfile(1080, 30);
let adaptiveController = window.TelaQuality.createAdaptiveController();
let isActuallyTransmitting = false;
let viewerVideoActive = false;

remoteVideo.muted = true;

function showStatus(text, state = "connecting") {
  statusText.textContent = text;
  connectionStatus.dataset.state = state;
}

function showError(target, error) {
  const messages = {
    NotAllowedError: "Permissao negada. Autorize o compartilhamento nas configuracoes do navegador e tente novamente.",
    NotFoundError: "Nenhuma tela ou janela disponivel para compartilhar.",
    NotReadableError: "A tela nao pode ser acessada. Feche outras capturas e tente de novo.",
    SecurityError: "O compartilhamento exige HTTPS ou acesso local por localhost.",
    AbortError: "O compartilhamento foi cancelado.",
    InvalidStateError: "Clique em compartilhar novamente para autorizar o navegador.",
    OverconstrainedError: "O navegador nao consegue aplicar este perfil a tela selecionada. Escolha um perfil menor.",
  };
  target.textContent = messages[error?.name] || error?.message || "Algo deu errado. Tente novamente.";
}

function setRoomView() {
  landing.hidden = true;
  roomView.hidden = false;
  roomGrid.hidden = true;
  nameEntry.hidden = false;
  roomTitle.textContent = "Entre na sala.";
  roomDescription.textContent = "Informe seu nome para entrar e aparecer na lista de participantes.";
  placeholderTitle.textContent = "Aguardando compartilhamento";
  placeholderDescription.textContent = "A mídia ao vivo é ponto a ponto entre o anfitrião e um visitante por vez.";
  shareButton.disabled = true;
  roomNameInput.focus();
  roomEyebrow.innerHTML = '<span class="eyebrow-line"></span> SALA DE COMPARTILHAMENTO';
  inviteLink.value = `${window.location.origin}/?room=${encodeURIComponent(roomId)}&role=viewer`;
  transmissionStatus.textContent = role === "host"
    ? "Nenhuma tela está sendo transmitida."
    : "Aguardando alguém iniciar o compartilhamento.";
  transmissionStatus.dataset.state = "waiting";
  resetQualityDashboard();
  updateCompatibilityMessage();
}

function renderParticipants(participants) {
  remoteParticipantName = participants.find((participant) => participant.role !== role)?.name || "";
  participantsCount.textContent = `${participants.length}/5`;
  participantsList.replaceChildren();
  if (!participants.length) {
    const empty = document.createElement("li");
    empty.className = "participants-empty";
    empty.textContent = "Ninguem na sala no momento.";
    participantsList.append(empty);
    return;
  }

  for (const participant of participants) {
    const item = document.createElement("li");
    const avatar = document.createElement("span");
    avatar.className = "participant-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = Array.from(participant.name)[0]?.toLocaleUpperCase() || "?";
    const details = document.createElement("span");
    details.className = "participant-details";
    const name = document.createElement("span");
    name.className = "participant-name";
    name.textContent = participant.name;
    const label = document.createElement("span");
    label.className = "participant-role";
    item.dataset.role = participant.role;
    label.textContent = `${participant.role === "host" ? "Anfitrião" : "Visitante"}${participant.role === role ? " · Você" : ""}`;
    details.append(name, label);
    item.append(avatar, details);
    participantsList.append(item);
  }
}

function markRemoteVideoActive() {
  if (playbackBlocked
    || remoteVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    || remoteVideo.videoWidth <= 0) return false;
  viewerVideoActive = true;
  videoPlaceholder.hidden = true;
  playVideoButton.hidden = true;
  liveLabel.hidden = false;
  liveText.textContent = "AO VIVO";
  transmissionStatus.textContent = screenStream && isActuallyTransmitting
    ? `Sua tela está sendo transmitida; você também está vendo a tela de ${remoteParticipantName || "a outra pessoa"}.`
    : `Você está vendo a tela de ${remoteParticipantName || "a outra pessoa"}.`;
  transmissionStatus.dataset.state = "active";
  return true;
}

function updateTransmissionState(active) {
  const changed = active !== isActuallyTransmitting;
  isActuallyTransmitting = active;
  if (active) {
    transmissionStatus.textContent = "Envio confirmado: o WebRTC está transmitindo seus quadros de vídeo.";
    transmissionStatus.dataset.state = "active";
    liveText.textContent = "ENVIANDO TELA";
  } else if (screenStream) {
    transmissionStatus.textContent = peerIsReady
      ? "Captura ativa nesta tela; aguardando confirmação de envio pelo WebRTC."
      : "Prévia local ativa; aguardando a outra pessoa entrar para iniciar o envio.";
    transmissionStatus.dataset.state = "waiting";
    liveText.textContent = "PRÉVIA LOCAL";
  } else {
    transmissionStatus.textContent = "Nenhuma tela está sendo transmitida.";
    transmissionStatus.dataset.state = "waiting";
    liveLabel.hidden = true;
  }
  if (changed && socket?.connected) socket.emit("sharing-state", { active });
}

function updateRemoteTransmissionState(active, remoteName) {
  if (active) {
    if (markRemoteVideoActive()) return;
    transmissionStatus.textContent = `${remoteName || "A outra pessoa"} iniciou o envio da tela. Aguardando a imagem aparecer.`;
    transmissionStatus.dataset.state = "waiting";
  } else {
    viewerVideoActive = false;
    transmissionStatus.textContent = remoteName
      ? `${remoteName} não está compartilhando a tela no momento.`
      : "A outra pessoa ainda não está enviando a tela.";
    if (screenStream && isActuallyTransmitting) {
      transmissionStatus.textContent = `Sua tela está sendo transmitida; ${remoteName || "a outra pessoa"} não está compartilhando a tela.`;
      transmissionStatus.dataset.state = "active";
      return;
    }
    transmissionStatus.dataset.state = "waiting";
    liveLabel.hidden = true;
    videoPlaceholder.hidden = false;
    placeholderTitle.textContent = "Aguardando compartilhamento";
    placeholderDescription.textContent = "A imagem aparecerá quando alguém na sala iniciar o envio.";
  }
}

function updateCompatibilityMessage() {
  const capabilities = window.TelaCompatibility.getCapabilities();
  const browser = window.TelaCompatibility.browser;
  const missing = [];
  if (!capabilities.displayCapture) missing.push("captura de tela");
  if (!capabilities.peerConnection) missing.push("WebRTC");
  if (!capabilities.stats) missing.push("monitoramento da conexao");
  const limitations = [];
  if (!capabilities.senderParameters) limitations.push("limite manual de bitrate indisponivel");
  if (!capabilities.codecPreferences) limitations.push("codec escolhido pela negociacao nativa");
  if (!capabilities.fullScreen) limitations.push("tela cheia indisponivel");
  const status = missing.length
    ? `este navegador nao oferece ${missing.join(", ")}. Atualize-o ou use Chrome, Edge, Brave ou Firefox.`
    : "WebRTC e captura nativos disponiveis. Codec, audio, resolucao e FPS finais dependem do navegador, da tela e da rede.";
  compatibilityMessage.textContent = `${browser}: ${status}${limitations.length ? ` ${limitations.join("; ")}.` : ""}`;
}

async function createRoom() {
  createRoomButton.disabled = true;
  landingMessage.textContent = "Criando sua sala…";
  try {
    const response = await fetch(new URL("/api/rooms", apiBaseUrl), { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Nao foi possivel criar a sala.");
    roomId = data.roomId;
    role = "host";
    hostToken = data.hostToken;
    history.replaceState(null, "", `/?room=${encodeURIComponent(roomId)}&role=host&token=${encodeURIComponent(hostToken)}`);
    setRoomView();
  } catch (error) {
    showError(landingMessage, error);
    createRoomButton.disabled = false;
  }
}

async function connectToRoom() {
  showStatus("Conectando à sala");
  try {
    if (typeof window.io !== "function") {
      throw new Error("O cliente de sinalizacao nao carregou. Atualize a pagina e tente novamente.");
    }

    const iceUrl = new URL("/api/ice", apiBaseUrl);
    iceUrl.searchParams.set("room", roomId);
    const iceResponse = await fetch(iceUrl);
    const iceData = await iceResponse.json();
    if (!iceResponse.ok) throw new Error(iceData.error || "Sala indisponivel.");
    iceServers = iceData.iceServers;

    if (socket) socket.disconnect();
    socket = window.io(apiBaseUrl, {
      auth: { roomId, role, token: hostToken, name: participantName },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 15000,
      timeout: 20000,
    });

    socket.on("connect", () => {
      showStatus("Sinalizacao conectada");
    });
    socket.on("joined", () => {
      showStatus("Sinalização conectada; aguardando transmissão");
      socket.emit("sharing-state", { active: isActuallyTransmitting });
    });
    socket.on("participants", renderParticipants);
    socket.on("sharing-state", ({ active, name }) => updateRemoteTransmissionState(active, name));
    socket.on("peer-ready", () => {
      peerIsReady = true;
      shareButton.disabled = false;
      showStatus("Outra pessoa entrou; mídia aguardando a tela");
      placeholderTitle.textContent = "A outra pessoa entrou";
      placeholderDescription.textContent = screenStream
        ? "Sua tela está pronta para ser enviada. O envio será confirmado quando houver quadros WebRTC."
        : "Você ou a outra pessoa podem iniciar o compartilhamento.";
      if (screenStream) updateTransmissionState(false);
      createPeerConnection();
    });
    socket.on("peer-left", () => {
      peerIsReady = false;
      shareButton.disabled = role !== "host";
      updateTransmissionState(false);
      closePeerConnection();
      updateRemoteTransmissionState(false, remoteParticipantName);
      placeholderTitle.textContent = "A outra pessoa saiu";
      placeholderDescription.textContent = "A tela compartilhada sera encerrada quando a pessoa sair da sala.";
      showStatus("A outra pessoa saiu da sala");
    });
    socket.on("media-waiting", ({ message } = {}) => {
      if (peerIsReady) return;
      shareButton.disabled = role !== "host";
      showStatus(message || "Aguardando uma conexão de mídia disponível");
    });
    socket.on("signal", (data) => {
      signalQueue = signalQueue.then(() => handleSignal(data)).catch((error) => {
        console.error("Falha ao negociar a conexao:", error);
        showStatus("Falha ao conectar as telas. Atualize a pagina.", "error");
      });
    });
    socket.on("connect_error", (error) => {
      showStatus(error.message || "Falha na conexao com a sala", "error");
      if (/sala está cheia/i.test(error.message || "")) {
        nameEntry.hidden = false;
        roomGrid.hidden = true;
        nameMessage.textContent = "Sala está cheia. O limite é de 5 pessoas.";
        shareButton.disabled = true;
        socket.disconnect();
        return;
      }
      if (/sala invalida|sala expirada/i.test(error.message || "")) socket.disconnect();
    });
    socket.on("disconnect", (reason) => {
      if (reason !== "io client disconnect") {
        showStatus("Sinalizacao desconectada. Reconectando automaticamente…");
      }
    });
    socket.io.on("reconnect_attempt", () => {
      showStatus("Reconectando à sala");
    });
    socket.io.on("reconnect", () => {
      showStatus("Sinalizacao reconectada; verificando a transmissao");
    });
  } catch (error) {
    showStatus(error.message || "Nao foi possivel entrar na sala", "error");
    if (role === "viewer") {
      placeholderTitle.textContent = "Nao foi possivel entrar";
      placeholderDescription.textContent = "Confira se o link esta correto ou se a sala expirou.";
    }
  }
}

function resetQualityDashboard() {
  metricResolution.textContent = "—";
  metricFps.textContent = "—";
  metricBitrate.textContent = "—";
  metricLatency.textContent = "—";
  metricPacketLoss.textContent = "—";
  metricCodec.textContent = "—";
  metricTransport.textContent = "Conexao aguardando";
  metricState.textContent = "Negociacao nao iniciada";
  transportType.textContent = "Mídia aguardando compartilhamento";
  connectionGrade.textContent = "Aguardando transmissão";
  connectionGrade.dataset.grade = "unknown";
  connectionStatus.dataset.quality = "unknown";
  qualityWarning.textContent = "";
  statsSample = null;
}

function closePeerConnection() {
  if (statsTimer) window.clearInterval(statsTimer);
  statsTimer = null;
  if (peerConnection) {
    peerConnection.ontrack = null;
    peerConnection.close();
    peerConnection = null;
  }
  pendingCandidates = [];
  makingOffer = false;
  negotiationPending = false;
  ignoreOffer = false;
  settingRemoteAnswerPending = false;
  viewerVideoActive = false;
  remoteVideo.srcObject = null;
  localPreview.srcObject = screenStream;
  remoteVideo.muted = true;
  audioToggle.disabled = true;
  audioToggle.textContent = "Áudio indisponível";
  audioToggle.setAttribute("aria-pressed", "false");
  videoPlaceholder.hidden = false;
  playVideoButton.hidden = true;
  playbackBlocked = false;
  liveLabel.hidden = true;
  resetQualityDashboard();
  if (screenStream) {
    placeholderTitle.textContent = "Prévia local da sua tela";
    placeholderDescription.textContent = "A confirmação de envio aparecerá quando os quadros forem transmitidos.";
    playLocalPreview();
  }
}

function playLocalPreview() {
  if (!screenStream) return;
  localPreview.srcObject = screenStream;
  localPreview.play().catch((error) => {
    if (error?.name !== "AbortError") {
      console.error("Nao foi possivel reproduzir a previa local:", error);
    }
  });
}

function sendSignal(data) {
  if (socket?.connected) socket.emit("signal", data);
}

function createPeerConnection() {
  closePeerConnection();
  const capabilities = window.TelaCompatibility.getCapabilities();
  if (!capabilities.peerConnection) {
    showStatus("Este navegador nao oferece suporte a WebRTC.", "error");
    return;
  }

  try {
    peerConnection = new RTCPeerConnection({ iceServers });
  } catch (error) {
    showStatus(error.message || "Nao foi possivel iniciar WebRTC.", "error");
    return;
  }
  const connection = peerConnection;

  connection.onicecandidate = (event) => {
    if (event.candidate) sendSignal({ type: "ice-candidate", candidate: event.candidate });
  };
  connection.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    remoteVideo.srcObject = stream;
    updateRemoteAudio(stream);

    if (event.track.kind === "video") {
      const renderLiveVideo = () => {
        if (remoteVideo.srcObject !== stream || playbackBlocked) return;
        placeholderTitle.textContent = "Conectado: aguardando imagem";
        placeholderDescription.textContent = "O vídeo aparecerá assim que os primeiros quadros chegarem.";
      };
      event.track.addEventListener("unmute", renderLiveVideo);
      event.track.addEventListener("mute", () => {
        if (remoteVideo.srcObject !== stream) return;
        videoPlaceholder.hidden = false;
        liveLabel.hidden = true;
        placeholderTitle.textContent = "Sinal de video interrompido";
        placeholderDescription.textContent = "Aguardando a recuperacao da conexao.";
        viewerVideoActive = false;
        transmissionStatus.textContent = "O vídeo recebido foi interrompido. Tentando recuperar a conexão.";
        transmissionStatus.dataset.state = "waiting";
      });
      event.track.addEventListener("ended", () => {
        if (remoteVideo.srcObject !== stream) return;
        videoPlaceholder.hidden = false;
        liveLabel.hidden = true;
        playVideoButton.hidden = true;
        placeholderTitle.textContent = "Compartilhamento encerrado";
        placeholderDescription.textContent = "A transmissão está disponível apenas para o anfitrião e o visitante conectado ao par de mídia.";
        viewerVideoActive = false;
        transmissionStatus.textContent = "A outra pessoa encerrou o compartilhamento.";
        transmissionStatus.dataset.state = "waiting";
      }, { once: true });
      playRemoteVideo(stream);
    }

    event.track.addEventListener("ended", () => updateRemoteAudio(stream));
    event.track.addEventListener("mute", () => updateRemoteAudio(stream));
    event.track.addEventListener("unmute", () => updateRemoteAudio(stream));
  };
  connection.onconnectionstatechange = () => {
    if (peerConnection !== connection) return;
    if (connection.connectionState === "connected") {
      showStatus("Conexao ponto a ponto ativa", "connected");
    } else if (connection.connectionState === "failed") {
      showStatus("Conexao WebRTC falhou. Tentando recuperar…", "error");
      updateTransmissionState(false);
    } else if (connection.connectionState === "disconnected") {
      showStatus("Conexao interrompida. Tentando recuperar…");
      updateTransmissionState(false);
    } else if (connection.connectionState === "connecting") {
      showStatus("Negociando conexao WebRTC");
    }
  };
  connection.onnegotiationneeded = () => {
    negotiationPending = true;
    negotiateConnection(connection);
  };
  connection.oniceconnectionstatechange = () => {
    if (connection.iceConnectionState === "failed") {
      try {
        connection.restartIce();
      } catch (error) {
        console.error("ICE nao pode ser reiniciado:", error);
      }
    }
  };
  if (typeof connection.getStats === "function") {
    statsTimer = window.setInterval(() => updateConnectionStats(connection), 2000);
  } else {
    metricState.textContent = "Estatisticas nao suportadas";
  }

  if (screenStream) {
    for (const track of screenStream.getTracks()) addOrReplaceTrack(track).catch(reportSenderError);
  }
}

async function negotiateConnection(connection) {
  if (!peerIsReady || peerConnection !== connection || !negotiationPending) return;
  if (makingOffer || connection.signalingState !== "stable") return;
  makingOffer = true;
  negotiationPending = false;
  try {
    await connection.setLocalDescription(await connection.createOffer());
    sendSignal({ type: connection.localDescription.type, description: connection.localDescription });
  } catch (error) {
    negotiationPending = false;
    showError(shareMessage, error);
  } finally {
    makingOffer = false;
    if (negotiationPending && connection.signalingState === "stable") {
      negotiateConnection(connection);
    }
  }
}

async function playRemoteVideo(stream) {
  try {
    await remoteVideo.play();
    if (remoteVideo.srcObject !== stream) return;
    playbackBlocked = false;
    playVideoButton.hidden = true;
  } catch (error) {
    if (remoteVideo.srcObject !== stream || error?.name === "AbortError") return;
    playbackBlocked = true;
    placeholderTitle.textContent = "Reproducao bloqueada pelo navegador";
    placeholderDescription.textContent = "Autorize a reproducao para assistir a transmissao.";
    playVideoButton.hidden = false;
    videoPlaceholder.hidden = false;
    liveLabel.hidden = true;
    showStatus("Clique em “Reproduzir vídeo” para iniciar a transmissão.", "connected");
  }
}

remoteVideo.addEventListener("playing", () => {
  if (!remoteVideo.srcObject || remoteVideo.videoWidth <= 0 || playbackBlocked) return;
  videoPlaceholder.hidden = true;
  liveLabel.hidden = false;
  markRemoteVideoActive();
});
remoteVideo.addEventListener("loadeddata", markRemoteVideoActive);
remoteVideo.addEventListener("timeupdate", markRemoteVideoActive);

async function addOrReplaceTrack(track) {
  if (!peerConnection || peerConnection.connectionState === "closed") return;
  const connection = peerConnection;
  let sender = connection.getSenders().find((item) => item.track?.kind === track.kind);
  if (!sender) {
    const transceiver = connection.getTransceivers().find((item) => (
      !item.sender.track && item.receiver.track?.kind === track.kind
    ));
    sender = transceiver?.sender;
  }
  if (sender) {
    await sender.replaceTrack(track);
    const transceiver = connection.getTransceivers().find((item) => item.sender === sender);
    if (transceiver && (transceiver.direction === "recvonly" || transceiver.direction === "inactive")) {
      transceiver.direction = "sendrecv";
    }
  } else {
    sender = connection.addTrack(track, screenStream);
  }
  if (track.kind === "video") {
    const transceiver = connection.getTransceivers().find((item) => item.sender === sender);
    if (transceiver) window.TelaCompatibility.prioritizeVideoCodecs(transceiver);
    applySelectedProfile();
  }
}

async function handleSignal(data) {
  if (!peerConnection) {
    if (!iceServers.length) throw new Error("Configuracao ICE ainda nao carregada.");
    createPeerConnection();
  }
  const connection = peerConnection;
  if (!connection) return;

  if (data.type === "offer" || data.type === "answer") {
    const description = data.description;
    if (!description || !["offer", "answer"].includes(description.type)) return;
    const polite = role === "viewer";
    const offerCollision = description.type === "offer"
      && (makingOffer || (connection.signalingState !== "stable" && !settingRemoteAnswerPending));
    ignoreOffer = !polite && offerCollision;
    if (ignoreOffer) return;
    if (offerCollision) {
      negotiationPending = true;
      await connection.setLocalDescription({ type: "rollback" });
    }
    settingRemoteAnswerPending = description.type === "answer";
    try {
      await connection.setRemoteDescription(description);
    } finally {
      settingRemoteAnswerPending = false;
    }
    for (const candidate of pendingCandidates.splice(0)) {
      await connection.addIceCandidate(candidate);
    }
    if (description.type === "offer") {
      await connection.setLocalDescription(await connection.createAnswer());
      sendSignal({ type: connection.localDescription.type, description: connection.localDescription });
    }
    if (negotiationPending && connection.signalingState === "stable") negotiateConnection(connection);
    return;
  }

  if (data.type === "ice-candidate" && data.candidate) {
    if (!connection.remoteDescription) {
      if (pendingCandidates.length < 64) pendingCandidates.push(data.candidate);
      return;
    }
    try {
      await connection.addIceCandidate(data.candidate);
    } catch (error) {
      if (!ignoreOffer && connection.signalingState !== "closed") throw error;
    }
  }
}

function profileFromControls() {
  return window.TelaQuality.makeProfile(qualityResolution.value, qualityFps.value);
}

function applySelectedProfile(bitrateOverride) {
  const track = screenStream?.getVideoTracks()[0];
  if (!track || !peerConnection) return;
  const sender = peerConnection.getSenders().find((item) => item.track?.kind === "video");
  if (!sender) return;
  const profile = selectedProfile;
  qualityApplyQueue = qualityApplyQueue
    .then(() => window.TelaQuality.applySenderProfile(sender, track, profile, bitrateOverride))
    .catch(reportSenderError);
}

function reportSenderError(error) {
  console.error("Nao foi possivel ajustar a qualidade da transmissao:", error);
  qualityWarning.textContent = "O navegador manteve as configuracoes suportadas para esta tela.";
}

function setAdaptiveQuality(metrics) {
  if (!screenStream?.getVideoTracks().length) return;
  const adjustment = adaptiveController.update(
    metrics,
    qualityModeButton.getAttribute("aria-pressed") === "true",
  );
  if (adjustment.changed) {
    const track = screenStream?.getVideoTracks()[0];
    const sender = peerConnection?.getSenders().find((item) => item.track?.kind === "video");
    if (track && sender) {
      const profile = adjustment.profile;
      qualityApplyQueue = qualityApplyQueue
        .then(() => window.TelaQuality.applySenderProfile(sender, track, profile, adjustment.bitrate))
        .catch(reportSenderError);
    }
    qualityWarning.textContent = adjustment.restoring
      ? adjustment.degraded
        ? "A conexao estabilizou; restaurando o perfil gradualmente."
        : "A conexao estabilizou; perfil selecionado restaurado."
      : "A rede esta congestionada: qualidade reduzida automaticamente para manter a transmissao. Restauraremos o perfil quando a conexao estabilizar.";
  }
}

function formatBitrate(value) {
  if (!Number.isFinite(value) || value < 0) return "—";
  return value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)} Mbps`
    : `${Math.round(value / 1000)} kbps`;
}

function updateQualityGrade(metrics) {
  const grade = window.TelaQuality.grade(metrics);
  const labels = {
    excellent: "Conexão excelente",
    stable: "Conexão estável",
    unstable: "Conexão instável",
    unknown: metrics.state === "new" || metrics.state === "connecting"
      ? "Aguardando transmissão"
      : "Medindo conexão",
  };
  connectionGrade.textContent = labels[grade];
  connectionGrade.dataset.grade = grade;
  connectionStatus.dataset.quality = grade;
}

function renderConnectionStats(metrics) {
  metricResolution.textContent = metrics.width && metrics.height
    ? `${metrics.width} × ${metrics.height}`
    : "—";
  metricFps.textContent = Number.isFinite(metrics.fps) ? `${Math.round(metrics.fps)} FPS` : "—";
  metricBitrate.textContent = formatBitrate(metrics.bitrate);
  metricLatency.textContent = Number.isFinite(metrics.latency) ? `${Math.round(metrics.latency)} ms` : "—";
  metricPacketLoss.textContent = Number.isFinite(metrics.packetLoss)
    ? `${(metrics.packetLoss * 100).toFixed(1)}%`
    : "—";
  metricCodec.textContent = metrics.codec || "—";
  metricTransport.textContent = metrics.transport
    ? `ICE: ${metrics.transport}`
    : "Tipo ICE aguardando";
  metricState.textContent = metrics.state === "connected"
    ? "WebRTC conectado"
    : `WebRTC: ${metrics.state}`;
  if (metrics.transport?.startsWith("RELAY")) {
    transportType.textContent = "P2P com retransmissao TURN";
  } else if (metrics.transport) {
    transportType.textContent = "Conexão ponto a ponto";
  } else if (metrics.state === "new" || metrics.state === "connecting") {
    transportType.textContent = "Mídia aguardando compartilhamento";
  }
  updateQualityGrade(metrics);
  setAdaptiveQuality(metrics);
  if (screenStream && peerIsReady && metrics.videoActive) {
    updateTransmissionState(true);
  } else if (!screenStream || !peerIsReady) {
    updateTransmissionState(false);
  }
}

async function updateConnectionStats(connection) {
  if (peerConnection !== connection || connection.connectionState === "closed" || statsRequestPending) return;
  statsRequestPending = true;
  try {
    const result = await window.TelaQuality.collectStats(
      connection,
      statsSample,
      screenStream ? "outbound" : "inbound",
    );
    if (peerConnection !== connection) return;
    statsSample = result.sample;
    renderConnectionStats(result.stats);
    if (result.stats.videoActive && !screenStream) markRemoteVideoActive();
  } catch (error) {
    console.error("Nao foi possivel ler as estatisticas WebRTC:", error);
    metricState.textContent = "Falha ao obter estatisticas";
  } finally {
    statsRequestPending = false;
  }
}

function updateRemoteAudio(stream) {
  const hasAudio = stream.getAudioTracks().some((track) => track.readyState === "live");
  audioToggle.disabled = !hasAudio;
  if (!hasAudio) {
    remoteVideo.muted = true;
    audioToggle.textContent = "Áudio indisponível";
    audioToggle.setAttribute("aria-pressed", "false");
    return;
  }
  if (remoteVideo.muted) {
    audioToggle.textContent = "Ativar áudio";
    audioToggle.setAttribute("aria-pressed", "false");
  } else {
    audioToggle.textContent = "Silenciar áudio";
    audioToggle.setAttribute("aria-pressed", "true");
  }
}

async function toggleScreenSharing() {
  shareMessage.textContent = "";
  if (screenStream) {
    stopScreenSharing();
    return;
  }

  const capabilities = window.TelaCompatibility.getCapabilities();
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    shareMessage.textContent = "O compartilhamento de tela requer HTTPS. Abra o endereco seguro da plataforma.";
    return;
  }
  if (!capabilities.displayCapture || !capabilities.peerConnection) {
    shareMessage.textContent = `${window.TelaCompatibility.browser}: a captura de tela ou o WebRTC nao estao disponiveis. Atualize o navegador e confira suas permissoes de privacidade.`;
    return;
  }

  selectedProfile = profileFromControls();
  adaptiveController.setProfile(selectedProfile);
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia(
      window.TelaCompatibility.getCaptureOptions(selectedProfile.fps, audioCapture.checked),
    );
    const videoTrack = screenStream.getVideoTracks()[0];
    if (!videoTrack) {
      for (const track of screenStream.getTracks()) track.stop();
      screenStream = null;
      throw new Error("O navegador nao forneceu uma faixa de video para a tela selecionada.");
    }

    localPreview.srcObject = screenStream;
    localPreview.hidden = false;
    playLocalPreview();
    if (!remoteVideo.srcObject) {
      videoPlaceholder.hidden = false;
      placeholderTitle.textContent = "Prévia local da sua tela";
      placeholderDescription.textContent = "Você pode assistir à tela da outra pessoa enquanto compartilha.";
    }
    videoTrack.addEventListener("ended", () => {
      if (screenStream) stopScreenSharing();
    }, { once: true });
    const audioTracks = screenStream.getAudioTracks();
    for (const track of audioTracks) {
      track.enabled = audioCapture.checked;
      track.addEventListener("ended", () => {
        if (screenStream?.getAudioTracks().every((audioTrack) => audioTrack.readyState === "ended")) {
          shareMessage.textContent = "O navegador ou a tela selecionada encerrou a captura de áudio.";
        }
      });
    }

    if (audioCapture.checked && !audioTracks.length) {
      shareMessage.textContent = "Esta tela ou navegador nao forneceu audio; o compartilhamento de video continua normalmente.";
    }
    for (const track of screenStream.getTracks()) {
      if (peerConnection) await addOrReplaceTrack(track);
    }
    applySelectedProfile();
    shareButton.innerHTML = "Parar compartilhamento <span aria-hidden=\"true\">■</span>";
    if (!audioCapture.checked || audioTracks.length) {
      shareMessage.textContent = "Captura local ativa. O envio só será confirmado quando o WebRTC transmitir quadros.";
    }
    updateTransmissionState(false);
  } catch (error) {
    if (screenStream) {
      for (const track of screenStream.getTracks()) track.stop();
      screenStream = null;
    }
    localPreview.srcObject = null;
    localPreview.hidden = true;
    liveLabel.hidden = true;
    videoPlaceholder.hidden = false;
    shareButton.innerHTML = 'Compartilhar tela <span aria-hidden="true">↗</span>';
    updateTransmissionState(false);
    showError(shareMessage, error);
  }
}

function stopScreenSharing() {
  const stream = screenStream;
  screenStream = null;
  if (!stream) return;
  const tracks = stream.getTracks();
  const senders = peerConnection?.getSenders() || [];
  const replacements = tracks.map((track) => {
    const sender = senders.find((item) => item.track === track);
    return sender ? sender.replaceTrack(null) : Promise.resolve();
  });
  Promise.all(replacements).catch(reportSenderError);
  for (const track of tracks) {
    if (track.readyState !== "ended") track.stop();
  }
  localPreview.srcObject = null;
  localPreview.hidden = true;
  shareButton.innerHTML = 'Compartilhar tela <span aria-hidden="true">↗</span>';
  shareMessage.textContent = "Compartilhamento encerrado.";
  if (!remoteVideo.srcObject) {
    videoPlaceholder.hidden = false;
    placeholderTitle.textContent = "Compartilhamento encerrado";
    placeholderDescription.textContent = "A transmissão está disponível apenas para o anfitrião e o visitante conectado ao par de mídia.";
  }
  updateTransmissionState(false);
}

async function copyInviteLink() {
  try {
    await navigator.clipboard.writeText(inviteLink.value);
    copyMessage.textContent = "Link copiado!";
  } catch {
    inviteLink.select();
    const copied = document.execCommand("copy");
    copyMessage.textContent = copied ? "Link copiado!" : "Selecione e copie o link.";
  }
}

createRoomButton.addEventListener("click", createRoom);
nameEntry.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = roomNameInput.value.trim();
  if (!name || name.length > 32) {
    nameMessage.textContent = "Digite um nome de 1 a 32 caracteres para entrar.";
    roomNameInput.focus();
    return;
  }
  participantName = name;
  nameMessage.textContent = "";
  nameEntry.hidden = true;
  roomGrid.hidden = false;
  roomTitle.textContent = role === "host" ? "Sua sala está pronta." : "Você entrou na sala.";
  roomDescription.textContent = role === "host"
    ? "Envie o link para até quatro pessoas entrarem. A mídia ao vivo é ponto a ponto entre o anfitrião e um visitante por vez."
    : "Você entrou na sala. A mídia ao vivo é ponto a ponto entre o anfitrião e um visitante por vez.";
  shareButton.disabled = true;
  renderParticipants([{ name: participantName, role }]);
  connectToRoom();
});
shareButton.addEventListener("click", toggleScreenSharing);
copyButton.addEventListener("click", copyInviteLink);
audioToggle.addEventListener("click", () => {
  if (!remoteVideo.srcObject?.getAudioTracks().some((track) => track.readyState === "live")) return;
  remoteVideo.muted = !remoteVideo.muted;
  updateRemoteAudio(remoteVideo.srcObject);
});
fullscreenToggle.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (typeof videoFrame.requestFullscreen === "function") {
      await videoFrame.requestFullscreen();
    } else {
      fullscreenToggle.textContent = "Tela cheia indisponível";
    }
  } catch (error) {
    showError(shareMessage, error);
  }
});
playVideoButton.addEventListener("click", () => {
  if (remoteVideo.srcObject) playRemoteVideo(remoteVideo.srcObject);
});
document.addEventListener("fullscreenchange", () => {
  fullscreenToggle.textContent = document.fullscreenElement ? "Sair da tela cheia" : "Tela cheia";
});
qualityModeButton.addEventListener("click", () => {
  const isAutomatic = qualityModeButton.getAttribute("aria-pressed") === "true";
  qualityModeButton.setAttribute("aria-pressed", String(!isAutomatic));
  qualityModeState.textContent = isAutomatic ? "Desativada" : "Ativada";
  selectedProfile = profileFromControls();
  adaptiveController.setProfile(selectedProfile);
  qualityWarning.textContent = "";
  applySelectedProfile();
});
function updateQualitySelection() {
  selectedProfile = profileFromControls();
  adaptiveController.setProfile(selectedProfile);
  qualityWarning.textContent = "";
  applySelectedProfile();
}
qualityResolution.addEventListener("change", updateQualitySelection);
qualityFps.addEventListener("change", updateQualitySelection);
audioCapture.addEventListener("change", () => {
  const tracks = screenStream?.getAudioTracks() || [];
  for (const track of tracks) track.enabled = audioCapture.checked;
  if (audioCapture.checked && !tracks.length && screenStream) {
    shareMessage.textContent = "Esta captura nao disponibiliza audio. Encerre e reinicie o compartilhamento para pedir audio ao navegador.";
  }
});
window.addEventListener("beforeunload", () => {
  if (statsTimer) window.clearInterval(statsTimer);
  if (socket?.connected) socket.disconnect();
  if (screenStream) {
    for (const track of screenStream.getTracks()) track.stop();
  }
  if (peerConnection) peerConnection.close();
});

const initialParams = new URLSearchParams(window.location.search);
const initialRoomId = initialParams.get("room");
if (initialRoomId) {
  const initialRole = initialParams.get("role");
  const initialToken = initialParams.get("token");
  if (!/^[a-zA-Z0-9_-]{12,32}$/.test(initialRoomId)
    || (initialRole !== "host" && initialRole !== "viewer")
    || (initialRole === "host" && !initialToken)) {
    landingMessage.textContent = "Este link de sala e invalido.";
  } else {
    roomId = initialRoomId;
    role = initialRole;
    hostToken = initialRole === "host" ? initialToken : null;
    setRoomView();
  }
}
