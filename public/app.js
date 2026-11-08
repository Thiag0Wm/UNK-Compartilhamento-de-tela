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
const remoteStreams = document.querySelector("#remote-streams");
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
const peerConnections = new Map();
const remoteStreamElements = new Map();
let screenStream = null;
let peerIsReady = false;
let iceServers = [];
let statsTimer = null;
let statsSample = null;
let statsRequestPending = false;
let playbackBlocked = false;
let signalQueue = Promise.resolve();
let qualityApplyQueue = Promise.resolve();
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
  placeholderDescription.textContent = "Até duas pessoas podem compartilhar a tela ao mesmo tempo.";
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
  for (const participant of participants) {
    const peer = peerConnections.get(participant.id);
    if (peer) {
      peer.name = participant.name;
      peer.sharing = participant.sharing;
    }
  }
  updateStatsConnection();
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
    label.textContent = `${participant.role === "host" ? "Anfitrião" : "Visitante"}${participant.role === role ? " · Você" : ""}${participant.sharing ? " · Compartilhando" : ""}`;
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
  updateRemoteViewStatus();
  return true;
}

function updateRemoteViewStatus() {
  const screens = remoteStreamElements.size
    ? "as telas compartilhadas na sala"
    : `a tela de ${remoteParticipantName || "outra pessoa"}`;
  transmissionStatus.textContent = screenStream && isActuallyTransmitting
    ? `Sua tela está sendo transmitida; você também está vendo ${screens}.`
    : `Você está vendo ${screens}.`;
  transmissionStatus.dataset.state = "active";
}

function promoteRemoteStream() {
  for (const [peerId, tile] of remoteStreamElements) {
    const video = tile.querySelector("video");
    const stream = video?.srcObject;
    if (!stream?.getVideoTracks().some((track) => track.readyState === "live")) continue;
    remoteVideo.srcObject = stream;
    remoteParticipantName = peerConnections.get(peerId)?.name || "a outra pessoa";
    tile.remove();
    remoteStreamElements.delete(peerId);
    updateRemoteAudio(stream);
    playRemoteVideo(stream);
    return true;
  }
  return false;
}

function updateTransmissionState(active) {
  const changed = active !== isActuallyTransmitting;
  isActuallyTransmitting = active;
  if (changed && socket?.connected) socket.emit("sharing-state", { active });
  if (active) {
    transmissionStatus.textContent = "Envio confirmado: o WebRTC está transmitindo seus quadros de vídeo.";
    transmissionStatus.dataset.state = "active";
    liveText.textContent = "ENVIANDO TELA";
  } else if (screenStream) {
    const remoteVideoActive = remoteVideo.srcObject?.getVideoTracks()
      .some((track) => track.readyState === "live");
    transmissionStatus.textContent = remoteVideoActive
      ? "Captura local ativa; aguardando confirmação do envio. Você também está recebendo uma tela."
      : peerIsReady
        ? "Captura ativa nesta tela; aguardando confirmação de envio pelo WebRTC."
        : "Prévia local ativa; aguardando a outra pessoa entrar para iniciar o envio.";
    transmissionStatus.dataset.state = "waiting";
    liveText.textContent = "PRÉVIA LOCAL";
  } else {
    const remoteSharer = Array.from(peerConnections.values()).find((peer) => peer.sharing);
    if (remoteSharer) {
      updateRemoteTransmissionState(true, remoteSharer.name);
    } else if (remoteVideo.srcObject?.getVideoTracks().some((track) => track.readyState === "live")) {
      markRemoteVideoActive();
    } else {
      transmissionStatus.textContent = "Nenhuma tela está sendo transmitida.";
      transmissionStatus.dataset.state = "waiting";
      liveLabel.hidden = true;
    }
  }
}

function updateRemoteTransmissionState(active, remoteName) {
  if (active) {
    if (markRemoteVideoActive()) return;
    transmissionStatus.textContent = `${remoteName || "A outra pessoa"} iniciou o envio da tela. Aguardando a imagem aparecer.`;
    transmissionStatus.dataset.state = "waiting";
  } else {
    const otherSharer = Array.from(peerConnections.values()).find((peer) => peer.sharing);
    if (otherSharer) {
      updateRemoteTransmissionState(true, otherSharer.name);
      return;
    }
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
      shareButton.disabled = false;
      socket.emit("sharing-state", { active: isActuallyTransmitting });
      if (screenStream) {
        requestSharingSlot(true).catch((error) => {
          showError(shareMessage, error);
          stopScreenSharing();
        });
      }
    });
    socket.on("participants", (participants) => {
      renderParticipants(participants);
    });
    socket.on("sharing-state", ({ active, name, peerId }) => {
      const peer = peerConnections.get(peerId);
      if (peer) {
        peer.sharing = active;
        if (name) peer.name = name;
      } else if (active) createPeerConnection(peerId, name);
      if (active && peer?.state.remoteStream) {
        attachRemoteStream(peerId, peer.name, peer.state.remoteStream);
      } else if (!active && peer) {
        removeRemotePeerStream(peerId);
      }
      updateStatsConnection();
      updateRemoteTransmissionState(active, name);
    });
    socket.on("peer-ready", ({ peerId, name, sharing } = {}) => {
      if (!peerId || peerId === socket.id) return;
      shareButton.disabled = false;
      createPeerConnection(peerId, name);
      const peer = peerConnections.get(peerId);
      if (peer) peer.sharing = Boolean(sharing);
      if (sharing) updateRemoteTransmissionState(true, name);
      updateStatsConnection();
      showStatus("Conectado à sala; pronto para receber telas compartilhadas");
    });
    socket.on("peer-left", ({ peerId } = {}) => {
      if (peerId) closePeerConnection(peerId);
      peerIsReady = peerConnections.size > 0;
      shareButton.disabled = false;
      if (!peerIsReady && !remoteVideo.srcObject) {
        placeholderTitle.textContent = "Aguardando compartilhamento";
        placeholderDescription.textContent = "Quando alguém compartilhar a tela, ela aparecerá aqui.";
      }
    });
    socket.on("signal", (data) => {
      signalQueue = signalQueue.then(() => handleSignal(data, data.peerId)).catch((error) => {
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

function closePeerConnection(peerId) {
  const states = peerId ? [[peerId, peerConnections.get(peerId)]] : Array.from(peerConnections);
  for (const [id, state] of states) {
    if (!state) continue;
    state.connection.ontrack = null;
    state.connection.close();
    peerConnections.delete(id);
    const tile = remoteStreamElements.get(id);
    if (tile) tile.remove();
    remoteStreamElements.delete(id);
    if (remoteVideo.srcObject === state.remoteStream) {
      remoteVideo.srcObject = null;
      remoteParticipantName = "";
      promoteRemoteStream();
    }
  }
  peerIsReady = peerConnections.size > 0;
  updateStatsConnection();
  if (!peerConnection) {
    remoteVideo.srcObject = null;
    videoPlaceholder.hidden = false;
    liveLabel.hidden = true;
    resetQualityDashboard();
  }
  localPreview.srcObject = screenStream;
  if (remoteVideo.srcObject) updateRemoteAudio(remoteVideo.srcObject);
  else {
    remoteVideo.muted = true;
    audioToggle.disabled = true;
    audioToggle.textContent = "Áudio indisponível";
    audioToggle.setAttribute("aria-pressed", "false");
  }
  if (screenStream) playLocalPreview();
}

function removeRemotePeerStream(peerId) {
  const peer = peerConnections.get(peerId);
  const tile = remoteStreamElements.get(peerId);
  if (tile) tile.remove();
  remoteStreamElements.delete(peerId);
  if (peer && remoteVideo.srcObject === peer.state.remoteStream) {
    remoteVideo.srcObject = null;
    remoteParticipantName = "";
    if (promoteRemoteStream()) return;
    videoPlaceholder.hidden = false;
    liveLabel.hidden = true;
    updateRemoteAudio(new MediaStream());
    placeholderTitle.textContent = screenStream
      ? "Sua tela está sendo transmitida"
      : "Aguardando compartilhamento";
    placeholderDescription.textContent = "A imagem aparecerá quando alguém na sala iniciar o envio.";
  }
}

function updateStatsConnection() {
  const peers = Array.from(peerConnections.values());
  const preferred = peers.find((peer) => peer.sharing && peer.connection.connectionState === "connected");
  const connected = peers.find((peer) => peer.connection.connectionState === "connected");
  const selected = screenStream
    ? connected || peers[0]
    : preferred || connected || peers[0];
  const nextConnection = selected?.connection || null;
  const changed = peerConnection !== nextConnection;
  if (changed) {
    if (statsTimer) window.clearInterval(statsTimer);
    statsTimer = null;
    peerConnection = nextConnection;
    statsSample = null;
  }
  if (!statsTimer && peerConnection && typeof peerConnection.getStats === "function") {
    statsTimer = window.setInterval(() => updateConnectionStats(peerConnection), 2000);
  }
  if (changed && peerConnection && typeof peerConnection.getStats === "function") {
    metricState.textContent = "Negociação WebRTC em andamento";
  }
  if (peerConnection && typeof peerConnection.getStats !== "function") {
    statsTimer = null;
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
  if (socket?.connected && data.peerId) {
    socket.emit("signal", data);
  }
}

function requestSharingSlot(active) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) {
      reject(new Error("Conecte-se à sala antes de compartilhar a tela."));
      return;
    }
    socket.timeout(5000).emit("request-sharing", { active }, (error, result) => {
      if (error) {
        reject(new Error("Não foi possível reservar uma vaga de compartilhamento. Tente novamente."));
        return;
      }
      if (!result?.ok) {
        reject(new Error(result?.message || "Não foi possível iniciar o compartilhamento."));
        return;
      }
      resolve();
    });
  });
}

function createPeerConnection(peerId, peerName = "") {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId).connection;
  const capabilities = window.TelaCompatibility.getCapabilities();
  if (!capabilities.peerConnection) {
    showStatus("Este navegador nao oferece suporte a WebRTC.", "error");
    return;
  }

  let connection;
  const state = {
    pendingCandidates: [],
    makingOffer: false,
    negotiationPending: false,
    ignoreOffer: false,
    settingRemoteAnswerPending: false,
    remoteStream: null,
  };
  try {
    connection = new RTCPeerConnection({ iceServers });
  } catch (error) {
    showStatus(error.message || "Nao foi possivel iniciar WebRTC.", "error");
    return;
  }
  peerConnections.set(peerId, { connection, state, name: peerName, sharing: false });
  peerIsReady = true;
  updateStatsConnection();

  connection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: "ice-candidate", candidate: event.candidate, peerId });
    }
  };
  connection.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    if (state.remoteStream === stream) return;
    state.remoteStream = stream;
    attachRemoteStream(peerId, peerConnections.get(peerId)?.name || peerName, stream);
  };
  connection.onconnectionstatechange = () => {
    updateStatsConnection();
    if (connection.connectionState === "connected") {
      showStatus(`Conexão de mídia ativa${peerName ? ` com ${peerName}` : ""}`, "connected");
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
    state.negotiationPending = true;
    negotiateConnection(connection, peerId, state);
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
  if (screenStream) {
    for (const track of screenStream.getTracks()) {
      addOrReplaceTrack(track, connection).catch(reportSenderError);
    }
  }
  return connection;
}

function attachRemoteStream(peerId, peerName, stream) {
  let video;
  const primaryHasVideo = remoteVideo.srcObject?.getVideoTracks()
    .some((track) => track.readyState === "live");
  if (!primaryHasVideo || remoteVideo.srcObject === stream) {
    video = remoteVideo;
    remoteVideo.srcObject = stream;
    remoteParticipantName = peerName || "a outra pessoa";
    updateRemoteAudio(stream);
  } else {
    let tile = remoteStreamElements.get(peerId);
    if (!tile) {
      tile = document.createElement("div");
      tile.className = "remote-stream-tile";
      const name = document.createElement("span");
      name.className = "remote-stream-name";
      name.textContent = peerName || "Participante";
      video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      const soundButton = document.createElement("button");
      soundButton.className = "remote-stream-audio";
      soundButton.type = "button";
      soundButton.textContent = "Ativar áudio";
      soundButton.setAttribute("aria-pressed", "false");
      soundButton.disabled = !stream.getAudioTracks().some((track) => track.readyState === "live");
      soundButton.addEventListener("click", () => {
        video.muted = !video.muted;
        soundButton.textContent = video.muted ? "Ativar áudio" : "Silenciar áudio";
        soundButton.setAttribute("aria-pressed", String(!video.muted));
        video.play().catch((error) => {
          if (error?.name !== "AbortError") {
            console.error("Nao foi possivel reproduzir o audio recebido:", error);
          }
        });
      });
      tile.append(video, name, soundButton);
      remoteStreams.append(tile);
      remoteStreamElements.set(peerId, tile);
      if (viewerVideoActive) updateRemoteViewStatus();
    } else {
      video = tile.querySelector("video");
    }
    video.srcObject = stream;
    video.play().catch((error) => {
      if (error?.name !== "AbortError") {
        console.error("Nao foi possivel reproduzir uma tela recebida:", error);
      }
    });
  }

  if (video === remoteVideo) playRemoteVideo(stream);
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      if (track.kind === "audio" && remoteVideo.srcObject === stream) updateRemoteAudio(stream);
      if (track.kind === "audio") {
        const soundButton = remoteStreamElements.get(peerId)?.querySelector(".remote-stream-audio");
        if (soundButton && !stream.getAudioTracks().some((audioTrack) => audioTrack.readyState === "live")) {
          soundButton.disabled = true;
          soundButton.textContent = "Áudio indisponível";
          soundButton.setAttribute("aria-pressed", "false");
        }
      }
      if (stream.getVideoTracks().some((videoTrack) => videoTrack.readyState === "live")) return;
      const tile = remoteStreamElements.get(peerId);
      if (tile && tile.querySelector("video").srcObject === stream) {
        tile.remove();
        remoteStreamElements.delete(peerId);
      }
      if (remoteVideo.srcObject === stream) {
        remoteVideo.srcObject = null;
        if (promoteRemoteStream()) return;
        videoPlaceholder.hidden = false;
        liveLabel.hidden = true;
        updateRemoteAudio(new MediaStream());
        if (screenStream) {
          placeholderTitle.textContent = "Sua tela está sendo transmitida";
          placeholderDescription.textContent = "Aguardando outra tela compartilhada na sala.";
        } else {
          placeholderTitle.textContent = "Aguardando compartilhamento";
          placeholderDescription.textContent = "Quando alguém compartilhar a tela, ela aparecerá aqui.";
        }
      }
    }, { once: true });
  }
}

async function negotiateConnection(connection, peerId, state) {
  if (!peerConnections.has(peerId) || !state.negotiationPending) return;
  if (state.makingOffer || connection.signalingState !== "stable") return;
  state.makingOffer = true;
  state.negotiationPending = false;
  try {
    await connection.setLocalDescription(await connection.createOffer());
    sendSignal({
      type: connection.localDescription.type,
      description: connection.localDescription,
      peerId,
    });
  } catch (error) {
    state.negotiationPending = false;
    showError(shareMessage, error);
  } finally {
    state.makingOffer = false;
    if (state.negotiationPending && connection.signalingState === "stable") {
      negotiateConnection(connection, peerId, state);
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

async function addOrReplaceTrack(track, connection = peerConnection) {
  if (!connection || connection.connectionState === "closed") return;
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
    applySelectedProfile(connection);
  }
}

async function handleSignal(data, peerId) {
  if (!peerConnections.has(peerId)) {
    if (!iceServers.length) throw new Error("Configuracao ICE ainda nao carregada.");
    createPeerConnection(peerId);
  }
  const peer = peerConnections.get(peerId);
  if (!peer) return;
  const { connection, state } = peer;

  if (data.type === "offer" || data.type === "answer") {
    const description = data.description;
    if (!description || !["offer", "answer"].includes(description.type)) return;
    const polite = socket.id > peerId;
    const offerCollision = description.type === "offer"
      && (state.makingOffer || (connection.signalingState !== "stable" && !state.settingRemoteAnswerPending));
    state.ignoreOffer = !polite && offerCollision;
    if (state.ignoreOffer) return;
    if (offerCollision) {
      state.negotiationPending = true;
      await connection.setLocalDescription({ type: "rollback" });
    }
    state.settingRemoteAnswerPending = description.type === "answer";
    try {
      await connection.setRemoteDescription(description);
    } finally {
      state.settingRemoteAnswerPending = false;
    }
    for (const candidate of state.pendingCandidates.splice(0)) {
      await connection.addIceCandidate(candidate);
    }
    if (description.type === "offer") {
      await connection.setLocalDescription(await connection.createAnswer());
      sendSignal({ type: connection.localDescription.type, description: connection.localDescription, peerId });
    }
    if (state.negotiationPending && connection.signalingState === "stable") {
      negotiateConnection(connection, peerId, state);
    }
    return;
  }

  if (data.type === "ice-candidate" && data.candidate) {
    if (!connection.remoteDescription) {
      if (state.pendingCandidates.length < 64) state.pendingCandidates.push(data.candidate);
      return;
    }
    try {
      await connection.addIceCandidate(data.candidate);
    } catch (error) {
      if (!state.ignoreOffer && connection.signalingState !== "closed") throw error;
    }
  }
}

function profileFromControls() {
  return window.TelaQuality.makeProfile(qualityResolution.value, qualityFps.value);
}

function applySelectedProfile(connection, bitrateOverride) {
  const track = screenStream?.getVideoTracks()[0];
  if (!track) return;
  const connections = connection
    ? [connection]
    : Array.from(peerConnections.values(), (peer) => peer.connection);
  const profile = selectedProfile;
  for (const peerConnection of connections) {
    const sender = peerConnection.getSenders().find((item) => item.track?.kind === "video");
    if (!sender) continue;
    qualityApplyQueue = qualityApplyQueue
      .then(() => window.TelaQuality.applySenderProfile(sender, track, profile, bitrateOverride))
      .catch(reportSenderError);
  }
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
    if (track) {
      const profile = adjustment.profile;
      for (const peer of peerConnections.values()) {
        const sender = peer.connection.getSenders().find((item) => item.track?.kind === "video");
        if (!sender) continue;
        qualityApplyQueue = qualityApplyQueue
          .then(() => window.TelaQuality.applySenderProfile(sender, track, profile, adjustment.bitrate))
          .catch(reportSenderError);
      }
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

    await requestSharingSlot(true);
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
      for (const peer of peerConnections.values()) {
        await addOrReplaceTrack(track, peer.connection);
      }
    }
    updateStatsConnection();
    applySelectedProfile();
    shareButton.innerHTML = "Parar compartilhamento <span aria-hidden=\"true\">■</span>";
    if (!audioCapture.checked || audioTracks.length) {
      shareMessage.textContent = "Captura local ativa. O envio só será confirmado quando o WebRTC transmitir quadros.";
    }
    updateTransmissionState(false);
  } catch (error) {
    if (screenStream) {
      if (socket?.connected) {
        socket.emit("request-sharing", { active: false });
      }
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
  if (socket?.connected) {
    socket.emit("request-sharing", { active: false });
  }
  const tracks = stream.getTracks();
  const replacements = [];
  for (const peer of peerConnections.values()) {
    const senders = peer.connection.getSenders();
    for (const track of tracks) {
      const sender = senders.find((item) => item.track === track);
      if (sender) replacements.push(sender.replaceTrack(null));
    }
  }
  Promise.all(replacements).catch(reportSenderError);
  updateStatsConnection();
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
    placeholderDescription.textContent = "Qualquer participante pode iniciar uma transmissão; até duas telas podem ser compartilhadas por vez.";
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
    ? "Envie o link para até quatro pessoas. Duas pessoas podem transmitir ao mesmo tempo; qualquer participante pode iniciar."
    : "Até duas pessoas podem transmitir ao mesmo tempo. Inicie quando quiser; não é necessário ser anfitrião.";
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
  closePeerConnection();
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
