(function () {
  const RESOLUTIONS = Object.freeze({
    720: Object.freeze({ width: 1280, height: 720 }),
    1080: Object.freeze({ width: 1920, height: 1080 }),
    1440: Object.freeze({ width: 2560, height: 1440 }),
    2160: Object.freeze({ width: 3840, height: 2160 }),
  });

  const BITRATE_BPS = Object.freeze({
    "720-30": 2_000_000,
    "720-60": 3_000_000,
    "1080-30": 5_000_000,
    "1080-60": 9_000_000,
    "1440-30": 10_000_000,
    "1440-60": 16_000_000,
    "2160-30": 20_000_000,
    "2160-60": 30_000_000,
  });

  function makeProfile(resolution, fps) {
    const dimensions = RESOLUTIONS[resolution] || RESOLUTIONS[1080];
    return {
      resolution: Number(resolution),
      width: dimensions.width,
      height: dimensions.height,
      fps: Number(fps) === 60 ? 60 : 30,
      bitrate: BITRATE_BPS[`${resolution}-${fps}`] || BITRATE_BPS["1080-30"],
    };
  }

  function createAdaptiveController() {
    let degradationLevel = 0;
    let poorIntervals = 0;
    let healthyIntervals = 0;
    let targetProfile = makeProfile(1080, 30);

    return {
      setProfile(profile) {
        targetProfile = profile;
        degradationLevel = 0;
        poorIntervals = 0;
        healthyIntervals = 0;
      },
      update(metrics, automatic) {
        if (!automatic || !metrics || metrics.state !== "connected") {
          return { changed: false, degraded: degradationLevel > 0 };
        }
        const capacityIsLimited = Number.isFinite(metrics.availableOutgoingBitrate)
          && metrics.availableOutgoingBitrate > 0
          && metrics.availableOutgoingBitrate < targetProfile.bitrate * 0.75;
        const connectionIsPoor = (Number.isFinite(metrics.latency) && metrics.latency > 400)
          || (Number.isFinite(metrics.packetLoss) && metrics.packetLoss > 0.05)
          || capacityIsLimited;
        const connectionIsHealthy = (!Number.isFinite(metrics.latency) || metrics.latency < 180)
          && (!Number.isFinite(metrics.packetLoss) || metrics.packetLoss < 0.015)
          && (!Number.isFinite(metrics.availableOutgoingBitrate)
            || metrics.availableOutgoingBitrate >= targetProfile.bitrate);

        poorIntervals = connectionIsPoor ? poorIntervals + 1 : 0;
        healthyIntervals = connectionIsHealthy ? healthyIntervals + 1 : 0;

        if (poorIntervals >= 3 && degradationLevel < 3) {
          degradationLevel += 1;
          poorIntervals = 0;
          healthyIntervals = 0;
          const scale = 0.82 ** degradationLevel;
          return {
            changed: true,
            degraded: true,
            profile: {
              ...targetProfile,
              width: Math.round(targetProfile.width * scale),
              height: Math.round(targetProfile.height * scale),
              fps: degradationLevel > 0 ? Math.min(targetProfile.fps, 30) : targetProfile.fps,
            },
            bitrate: targetProfile.bitrate * (0.65 ** degradationLevel),
            restoring: false,
          };
        }
        if (degradationLevel > 0 && healthyIntervals >= 8) {
          degradationLevel -= 1;
          poorIntervals = 0;
          healthyIntervals = 0;
          const scale = 0.82 ** degradationLevel;
          return {
            changed: true,
            degraded: degradationLevel > 0,
            profile: {
              ...targetProfile,
              width: Math.round(targetProfile.width * scale),
              height: Math.round(targetProfile.height * scale),
              fps: degradationLevel > 0 ? Math.min(targetProfile.fps, 30) : targetProfile.fps,
            },
            bitrate: targetProfile.bitrate * (0.65 ** degradationLevel),
            restoring: true,
          };
        }
        return { changed: false, degraded: degradationLevel > 0 };
      },
    };
  }

  function collectStats(peerConnection, previousSample, direction = "inbound") {
    return peerConnection.getStats().then((report) => {
      const reports = [];
      report.forEach((entry) => reports.push(entry));
      const inbound = reports.find((entry) => entry.type === "inbound-rtp"
        && (entry.kind === "video" || entry.mediaType === "video"));
      const outbound = reports.find((entry) => entry.type === "outbound-rtp"
        && (entry.kind === "video" || entry.mediaType === "video")
        && !entry.isRemote);
      const primary = direction === "outbound" ? outbound || inbound : inbound || outbound;
      const isInbound = primary === inbound;
      const now = performance.now();
      const bytes = isInbound ? inbound?.bytesReceived : outbound?.bytesSent;
      const bitrate = Number.isFinite(bytes) && previousSample && previousSample.bytes !== null
        && now > previousSample.time
        ? Math.max(0, ((bytes - previousSample.bytes) * 8 * 1000) / (now - previousSample.time))
        : null;
      const frames = isInbound
        ? inbound?.framesDecoded ?? inbound?.framesReceived
        : outbound?.framesEncoded;
      const measuredFps = Number.isFinite(primary?.framesPerSecond)
        ? primary.framesPerSecond
        : Number.isFinite(frames) && previousSample && Number.isFinite(previousSample.frames)
          && now > previousSample.time
          ? Math.max(0, ((frames - previousSample.frames) * 1000) / (now - previousSample.time))
          : null;
      const pair = reports.find((entry) => entry.type === "candidate-pair"
        && (entry.selected || (entry.nominated && entry.state === "succeeded")));
      const localCandidate = reports.find((entry) => entry.id === pair?.localCandidateId);
      const remoteCandidate = reports.find((entry) => entry.id === pair?.remoteCandidateId);
      const transportCandidate = localCandidate || remoteCandidate;
      const codec = reports.find((entry) => entry.id === primary?.codecId);
      const remoteInbound = reports.find((entry) => entry.type === "remote-inbound-rtp"
        && entry.kind === "video");
      const received = isInbound ? inbound?.packetsReceived : undefined;
      const lost = isInbound ? inbound?.packetsLost : undefined;
      const packetLoss = Number.isFinite(received) && Number.isFinite(lost) && received + lost > 0
        ? Math.max(0, lost / (received + lost))
        : Number.isFinite(remoteInbound?.fractionLost)
          ? Math.max(0, remoteInbound.fractionLost)
          : null;
      const stats = {
        videoActive: peerConnection.connectionState === "connected"
          && Number.isFinite(frames)
          && Number.isFinite(previousSample?.frames)
          && frames > previousSample.frames,
        width: primary?.frameWidth ?? primary?.frameWidthReceived ?? null,
        height: primary?.frameHeight ?? primary?.frameHeightReceived ?? null,
        fps: measuredFps,
        bitrate,
        latency: Number.isFinite(pair?.currentRoundTripTime)
          ? pair.currentRoundTripTime * 1000
          : Number.isFinite(remoteInbound?.roundTripTime)
            ? remoteInbound.roundTripTime * 1000
            : null,
        packetLoss,
        codec: codec?.mimeType?.replace(/^video\//i, "").toUpperCase() || null,
        transport: transportCandidate?.candidateType
          ? `${transportCandidate.candidateType.toUpperCase()} / ${(transportCandidate.protocol || "IP").toUpperCase()}`
          : null,
        availableOutgoingBitrate: Number.isFinite(pair?.availableOutgoingBitrate)
          ? pair.availableOutgoingBitrate
          : null,
        state: peerConnection.connectionState || peerConnection.iceConnectionState || "unknown",
      };
      return {
        stats,
        sample: {
          bytes: Number.isFinite(bytes) ? bytes : null,
          frames: Number.isFinite(frames) ? frames : null,
          time: now,
        },
      };
    });
  }

  function grade(metrics) {
    if (!metrics || metrics.state !== "connected") return "unknown";
    const latency = metrics.latency;
    const loss = metrics.packetLoss;
    if (!Number.isFinite(latency) && !Number.isFinite(loss)) return "unknown";
    if (Number.isFinite(latency) && latency < 150
      && (!Number.isFinite(loss) || loss < 0.01)) return "excellent";
    if ((!Number.isFinite(latency) || latency < 400)
      && (!Number.isFinite(loss) || loss < 0.05)) return "stable";
    return "unstable";
  }

  async function applySenderProfile(sender, track, profile, bitrateOverride) {
    if (track) {
      if ("contentHint" in track) track.contentHint = "detail";
      await window.TelaCompatibility.applyCaptureConstraints(
        track,
        profile.width,
        profile.height,
        profile.fps,
      );
    }

    if (!sender || typeof sender.getParameters !== "function"
      || typeof sender.setParameters !== "function") return;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) return;
    parameters.encodings[0].maxBitrate = bitrateOverride || profile.bitrate;
    parameters.encodings[0].maxFramerate = profile.fps;
    if ("degradationPreference" in parameters) {
      parameters.degradationPreference = "maintain-resolution";
    }
    await sender.setParameters(parameters);
  }

  window.TelaQuality = Object.freeze({
    makeProfile,
    createAdaptiveController,
    collectStats,
    grade,
    applySenderProfile,
  });
})();
