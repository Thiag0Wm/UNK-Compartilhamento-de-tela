const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadQualityModule(now = () => performance.now()) {
  const context = {
    performance: { now },
    window: {},
  };
  const source = fs.readFileSync(path.join(__dirname, "public", "quality.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "quality.js" });
  return context.window.TelaQuality;
}

test("reports video quality metrics from WebRTC stats", async () => {
  let time = 1000;
  const quality = loadQualityModule(() => time);
  let bytesReceived = 10_000;
  let framesDecoded = 100;
  const connection = {
    connectionState: "connected",
    async getStats() {
      return new Map([
        ["video", {
          type: "inbound-rtp",
          kind: "video",
          bytesReceived,
          framesDecoded,
          packetsReceived: 980,
          packetsLost: 20,
          frameWidth: 1920,
          frameHeight: 1080,
          codecId: "video-codec",
        }],
        ["pair", {
          type: "candidate-pair",
          selected: true,
          currentRoundTripTime: 0.1,
          availableOutgoingBitrate: 5_000_000,
          localCandidateId: "local",
        }],
        ["local", {
          id: "local",
          candidateType: "host",
          protocol: "udp",
        }],
        ["video-codec", {
          id: "video-codec",
          mimeType: "video/VP8",
        }],
      ]);
    },
  };

  const first = await quality.collectStats(connection, null);
  assert.equal(first.stats.bitrate, null);
  assert.equal(first.stats.videoActive, false);
  time += 1000;
  bytesReceived += 62_500;
  framesDecoded += 30;
  const second = await quality.collectStats(connection, first.sample);

  assert.equal(second.stats.width, 1920);
  assert.equal(second.stats.height, 1080);
  assert.equal(second.stats.fps, 30);
  assert.equal(second.stats.bitrate, 500_000);
  assert.equal(second.stats.latency, 100);
  assert.equal(second.stats.packetLoss, 0.02);
  assert.equal(second.stats.codec, "VP8");
  assert.equal(second.stats.videoActive, true);
  time += 1000;
  const unchanged = await quality.collectStats(connection, second.sample);
  assert.equal(unchanged.stats.videoActive, false);
  assert.equal(second.stats.transport, "HOST / UDP");
  assert.equal(quality.grade(second.stats), "stable");
});

test("confirms video only after frames are encoded or decoded during the stats interval", async () => {
  let time = 0;
  let framesEncoded = 10;
  const quality = loadQualityModule(() => time);
  const connection = {
    connectionState: "connected",
    async getStats() {
      return new Map([["video", {
        type: "outbound-rtp",
        kind: "video",
        bytesSent: framesEncoded * 1000,
        framesEncoded,
        frameWidth: 1920,
        frameHeight: 1080,
      }]]);
    },
  };

  const first = await quality.collectStats(connection, null);
  assert.equal(first.stats.videoActive, false);
  time += 2000;
  framesEncoded += 60;
  const transmitting = await quality.collectStats(connection, first.sample);
  assert.equal(transmitting.stats.videoActive, true);
  time += 2000;
  const stalled = await quality.collectStats(connection, transmitting.sample);
  assert.equal(stalled.stats.videoActive, false);
});

test("uses outbound video frames for the host even when an idle inbound video report exists", async () => {
  let time = 0;
  let framesEncoded = 1;
  const quality = loadQualityModule(() => time);
  const connection = {
    connectionState: "connected",
    async getStats() {
      return new Map([
        ["inbound", {
          type: "inbound-rtp",
          kind: "video",
          bytesReceived: 0,
          framesDecoded: 0,
          frameWidth: 0,
          frameHeight: 0,
        }],
        ["outbound", {
          type: "outbound-rtp",
          kind: "video",
          bytesSent: framesEncoded * 1000,
          framesEncoded,
          frameWidth: 1920,
          frameHeight: 1080,
        }],
      ]);
    },
  };

  const first = await quality.collectStats(connection, null, "outbound");
  time += 2000;
  framesEncoded += 60;
  const second = await quality.collectStats(connection, first.sample, "outbound");
  assert.equal(second.stats.videoActive, true);
  assert.equal(second.stats.width, 1920);
  assert.equal(second.stats.height, 1080);
  assert.equal(second.stats.fps, 30);
});

test("automatically reduces quality under congestion and restores the requested profile", () => {
  const quality = loadQualityModule();
  const controller = quality.createAdaptiveController();
  controller.setProfile(quality.makeProfile(1080, 60));
  const congested = {
    state: "connected",
    latency: 700,
    packetLoss: 0.1,
    availableOutgoingBitrate: 500_000,
  };
  let reduction;
  for (let interval = 0; interval < 3; interval += 1) {
    reduction = controller.update(congested, true);
  }
  assert.equal(reduction.changed, true);
  assert.equal(reduction.degraded, true);
  assert.equal(reduction.profile.fps, 30);
  assert.equal(reduction.bitrate, 5_850_000);

  const recovered = {
    state: "connected",
    latency: 80,
    packetLoss: 0,
    availableOutgoingBitrate: 12_000_000,
  };
  let restoration;
  for (let interval = 0; interval < 8; interval += 1) {
    restoration = controller.update(recovered, true);
  }
  assert.equal(restoration.changed, true);
  assert.equal(restoration.degraded, false);
  assert.equal(restoration.restoring, true);
  assert.equal(restoration.profile.width, 1920);
  assert.equal(restoration.profile.fps, 60);
});
