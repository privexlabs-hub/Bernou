/**
 * Microphone audio graph.
 *
 *   mic track ─▶ MediaStreamAudioSourceNode ─┬─▶ AnalyserNode (meter)
 *                                            └─▶ BiquadFilter(low-cut) ─▶ GainNode(mute) ─▶ MediaStreamAudioDestinationNode (→ recorder)
 *
 * The graph is NEVER connected to AudioContext.destination (the speakers), so
 * there is no local monitoring feedback. Muting is gain=0 rather than
 * track.enabled=false, so the recorder's timeline stays continuous and the
 * meter still shows that the mic is alive.
 */

/**
 * The recording's low-cut: takes out rumble below the voice (wind buffeting,
 * traffic and engine drone, handling noise, hum) and leaves speech alone.
 * It does nothing for sounds in the voice's own range; the browser's noise
 * suppression is all that acts on those.
 */
export const LOW_CUT_HZ = 80;
/** Butterworth: flat to the corner, no bump. A highpass's Q is in dB in Web Audio, so this is 20·log10(1/√2), not 0.707. */
export const LOW_CUT_Q = 20 * Math.log10(Math.SQRT1_2);

export interface AudioGraph {
  readonly context: AudioContext;
  /** Stream carrying the processed (gain-applied) microphone — feed to recorders. */
  readonly outputStream: MediaStream;
  readonly analyser: AnalyserNode;
  setSource(stream: MediaStream | null): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  /** 0..1 RMS level of the *pre-mute* signal, so the meter works while muted. */
  level(): number;
  /** 0..1 peak since last call. */
  peak(): number;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export function createAudioGraph(ctx: AudioContext = new AudioContext()): AudioGraph {
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = "highpass";
  lowCut.frequency.value = LOW_CUT_HZ;
  lowCut.Q.value = LOW_CUT_Q;
  const gain = ctx.createGain();
  lowCut.connect(gain);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.6;
  const dest = ctx.createMediaStreamDestination();
  gain.connect(dest);
  // With nothing playing into it the output stops producing audio, and a recorder
  // relying on that track can end up with a file that stops early too. Turning
  // the mic off must give silence, not nothing.
  const silence = ctx.createConstantSource();
  silence.offset.value = 0;
  silence.connect(dest);
  silence.start();
  // Analyser taps the source BEFORE gain so the level is visible while muted.
  // It's before the low-cut too, so the meter still shows rumble the recording won't have.
  let source: MediaStreamAudioSourceNode | null = null;
  let muted = false;
  const buf = new Float32Array(analyser.fftSize);
  let peakHold = 0;

  const measure = () => {
    if (!source) return 0;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let pk = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i]!;
      sum += v * v;
      const a = Math.abs(v);
      if (a > pk) pk = a;
    }
    peakHold = Math.max(peakHold, pk);
    return Math.min(1, Math.sqrt(sum / buf.length) * 3); // ×3: speech RMS is small
  };

  return {
    context: ctx,
    outputStream: dest.stream,
    analyser,
    setSource(stream) {
      if (source) {
        source.disconnect();
        source = null;
      }
      if (stream && stream.getAudioTracks().length > 0) {
        source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        source.connect(lowCut);
      }
    },
    setMuted(m) {
      muted = m;
      gain.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.01);
    },
    isMuted: () => muted,
    level: measure,
    peak() {
      const p = peakHold;
      peakHold = 0;
      return p;
    },
    resume: () => (ctx.state === "suspended" ? ctx.resume() : Promise.resolve()),
    async close() {
      source?.disconnect();
      source = null;
      lowCut.disconnect();
      gain.disconnect();
      analyser.disconnect();
      for (const t of dest.stream.getTracks()) t.stop();
      if (ctx.state !== "closed") await ctx.close();
    },
  };
}
