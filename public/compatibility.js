(function () {
  const originalCaptureSettings = new WeakMap();
  const browser = (() => {
    const userAgent = navigator.userAgent;
    const brands = navigator.userAgentData?.brands?.map((brand) => brand.brand) || [];
    if (brands.some((brand) => /Microsoft Edge/i.test(brand)) || /Edg\//i.test(userAgent)) {
      return "Microsoft Edge";
    }
    if (/Firefox\//i.test(userAgent)) return "Firefox";
    if (/Chrome\//i.test(userAgent) && navigator.brave) return "Brave";
    if (brands.some((brand) => /^Google Chrome$/i.test(brand))) return "Chrome";
    if (/Chrome\//i.test(userAgent)) return "Chromium";
    return "navegador compatível";
  })();

  function getCapabilities() {
    return {
      displayCapture: Boolean(navigator.mediaDevices?.getDisplayMedia),
      peerConnection: typeof RTCPeerConnection === "function",
      senderParameters: typeof RTCRtpSender !== "undefined"
        && typeof RTCRtpSender.prototype.setParameters === "function",
      senderCapabilities: typeof RTCRtpSender !== "undefined"
        && typeof RTCRtpSender.getCapabilities === "function",
      codecPreferences: typeof RTCRtpTransceiver !== "undefined"
        && typeof RTCRtpTransceiver.prototype.setCodecPreferences === "function",
      stats: typeof RTCPeerConnection === "function"
        && typeof RTCPeerConnection.prototype.getStats === "function",
      fullScreen: typeof document.documentElement.requestFullscreen === "function",
    };
  }

  function getCaptureOptions(fps, audio) {
    return {
      video: { frameRate: { ideal: fps } },
      audio: Boolean(audio),
    };
  }

  async function applyCaptureConstraints(track, width, height, fps) {
    if (typeof track.applyConstraints !== "function") return false;
    if (!originalCaptureSettings.has(track)) {
      originalCaptureSettings.set(track, {
        settings: track.getSettings?.() || {},
        capabilities: track.getCapabilities?.() || {},
      });
    }
    const { settings, capabilities } = originalCaptureSettings.get(track);
    const maximumWidth = Number.isFinite(settings.width) && settings.width > 0
      ? Math.min(width, settings.width)
      : width;
    const maximumHeight = Number.isFinite(settings.height) && settings.height > 0
      ? Math.min(height, settings.height)
      : height;
    const maximumFps = Number.isFinite(capabilities.frameRate?.max)
      ? Math.min(fps, capabilities.frameRate.max)
      : fps;

    try {
      await track.applyConstraints({
        width: { max: maximumWidth },
        height: { max: maximumHeight },
        frameRate: { ideal: maximumFps, max: maximumFps },
      });
      return true;
    } catch (error) {
      if (error?.name !== "OverconstrainedError" && error?.name !== "NotSupportedError") {
        throw error;
      }
      try {
        await track.applyConstraints({ frameRate: { ideal: maximumFps, max: maximumFps } });
        return false;
      } catch (fallbackError) {
        if (fallbackError?.name !== "OverconstrainedError" && fallbackError?.name !== "NotSupportedError") {
          throw fallbackError;
        }
        return false;
      }
    }
  }

  function prioritizeVideoCodecs(transceiver) {
    if (typeof transceiver.setCodecPreferences !== "function"
      || typeof RTCRtpReceiver === "undefined"
      || typeof RTCRtpReceiver.getCapabilities !== "function") return false;
    let capabilities;
    try {
      capabilities = RTCRtpReceiver.getCapabilities("video");
    } catch (error) {
      console.warn("O navegador nao informou codecs de video; usando a negociacao padrao.", error);
      return false;
    }
    if (!capabilities?.codecs?.length) return false;
    const preference = new Map([
      ["video/av1", 0],
      ["video/vp9", 1],
      ["video/h264", 2],
      ["video/vp8", 3],
    ]);
    const codecs = capabilities.codecs
      .map((codec, index) => ({ codec, index }))
      .sort((left, right) => {
        const leftMime = left.codec.mimeType.toLowerCase();
        const rightMime = right.codec.mimeType.toLowerCase();
        const leftRank = preference.has(leftMime) ? preference.get(leftMime) : 4;
        const rightRank = preference.has(rightMime) ? preference.get(rightMime) : 4;
        return leftRank - rightRank || left.index - right.index;
      })
      .map(({ codec }) => codec);
    try {
      transceiver.setCodecPreferences(codecs);
      return true;
    } catch (error) {
      console.warn("O navegador nao aceitou preferencia de codec; usando a negociacao padrao.", error);
      return false;
    }
  }

  window.TelaCompatibility = Object.freeze({
    browser,
    getCapabilities,
    getCaptureOptions,
    applyCaptureConstraints,
    prioritizeVideoCodecs,
  });
})();
