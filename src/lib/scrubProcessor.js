// AudioWorklet processor for turntable-style scrubbing of a decoded preview (see audioEngine.js).
//
// It's a POSITION FOLLOWER, not a rate engine. It holds one mono copy of the preview's samples, a
// floating playhead `pos`, and a `target` position the UI updates each frame (where your finger is).
// Every processing block it computes the speed needed to glide `pos` toward `target` over roughly one
// frame and resamples the buffer at that speed — so it plays through EVERY sample between the old and
// new finger position. That's what makes it sound like the actual song (slowed and pitched down when
// you move slowly, reversed when you pull backward) instead of a grainy scratch: the pitch follows
// your hand's speed continuously, and direction follows whether `target` is ahead of or behind `pos`.
//
// A short gain ramp gates the output to silence when the playhead has caught up to the target (finger
// held still — like a hand resting on the record) and prevents clicks at start/stop and zero-cross.
class ScrubProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.data = null   // Float32Array — mono preview samples
    this.len = 0
    this.pos = 0       // fractional sample index (the playhead)
    this.target = 0    // sample index the finger is at
    this.gain = 0      // smoothed output gain
    this.frameSamples = sampleRate / 60 // ≈ samples per animation frame → sets the glide horizon
    this.port.onmessage = (e) => {
      const m = e.data
      if (m.type === 'load') { this.data = m.data; this.len = m.data.length; this.pos = m.pos || 0; this.target = this.pos }
      else if (m.type === 'target') { this.target = Math.max(0, Math.min(m.pos, this.len - 1)) }
      else if (m.type === 'stop') { this.target = this.pos } // hold in place → glides to silence
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0]
    const ch = out[0]
    const data = this.data
    if (!data || this.len < 2) { ch.fill(0); return true }
    const maxPos = this.len - 1
    // Speed (samples per output-sample) to cover the remaining finger distance in ~one frame. Signed,
    // so target behind the playhead plays in reverse. Clamped so a fast flick doesn't alias into noise.
    let rate = (this.target - this.pos) / this.frameSamples
    if (rate > 8) rate = 8
    else if (rate < -8) rate = -8
    const target = Math.abs(rate) > 0.0008 ? 1 : 0
    for (let i = 0; i < ch.length; i++) {
      this.gain += (target - this.gain) * 0.02
      let p = this.pos
      if (p < 0) p = 0
      else if (p > maxPos) p = maxPos
      const i0 = p | 0
      const frac = p - i0
      const s0 = data[i0]
      const s1 = i0 + 1 <= maxPos ? data[i0 + 1] : s0
      ch[i] = (s0 + (s1 - s0) * frac) * this.gain
      this.pos += rate
      if (this.pos < 0) this.pos = 0
      else if (this.pos > maxPos) this.pos = maxPos
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch) // duplicate mono to every output channel
    return true
  }
}

registerProcessor('scrub-processor', ScrubProcessor)
