import type { WeatherId } from './config/weather';
import type { Judgement } from './sim/rhythm';

/** A-major-ish progression (semitones above A1) cycled per bar. */
const PROGRESSION = [0, 7, 9, 5];
const ROOT_HZ = 55;
const LOOKAHEAD_SEC = 0.12;

const hz = (semitones: number): number => ROOT_HZ * Math.pow(2, semitones / 12);

/**
 * Procedural WebAudio music + SFX. Music is scheduled in beat space: the game supplies
 * the current beat coordinate and tempo each frame and notes are queued slightly ahead,
 * so the soundtrack stays locked to the runner's stride as speed changes.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private rain!: GainNode;
  private noise!: AudioBuffer;
  private lastStep = Number.NEGATIVE_INFINITY;
  muted = false;

  /** Must be called from a user gesture (iOS/Chrome autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.music.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Looping rain bed, faded in by weather.
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noise;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2500;
    rainFilter.Q.value = 0.4;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rain).connect(this.master);
    rainSrc.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resetMusic(): void {
    this.lastStep = Number.NEGATIVE_INFINITY;
  }

  /** Schedules upcoming 8th-note steps. `intensity` 0 = menu, 1 = run, 2 = combo layer. */
  updateMusic(beat: number, beatsPerSecond: number, intensity: number, weather: WeatherId, footsteps: boolean): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || beatsPerSecond <= 0) return;
    this.rain.gain.setTargetAtTime(weather === 'rain' ? 0.12 : weather === 'snow' ? 0.03 : 0, ctx.currentTime, 0.5);

    const latency = ctx.outputLatency || ctx.baseLatency || 0;
    const lastToSchedule = Math.floor((beat + LOOKAHEAD_SEC * beatsPerSecond) * 2);
    if (this.lastStep < lastToSchedule - 8) this.lastStep = lastToSchedule - 1;
    for (let step = this.lastStep + 1; step <= lastToSchedule; step++) {
      const stepBeat = step / 2;
      const when = Math.max(ctx.currentTime, ctx.currentTime + (stepBeat - beat) / beatsPerSecond - latency);
      this.playStep(step, when, intensity, footsteps, weather);
    }
    this.lastStep = lastToSchedule;
  }

  private playStep(step: number, t: number, intensity: number, footsteps: boolean, weather: WeatherId): void {
    const onBeat = step % 2 === 0;
    const beatInBar = Math.floor(step / 2) % 4;
    const bar = Math.floor(step / 8);
    const chord = PROGRESSION[((bar % 4) + 4) % 4]!;

    if (step % 16 === 0) this.pad(t, chord, 8 / 2);
    if (intensity === 0) {
      if (!onBeat) this.hat(t, 0.08);
      return;
    }
    if (onBeat) {
      if (beatInBar === 0 || beatInBar === 2) this.kick(t, 1);
      if (beatInBar === 1 || beatInBar === 3) this.snare(t);
      if (footsteps) this.footstep(t, weather);
      this.bass(t, chord + (beatInBar === 2 ? 12 : 0));
    } else {
      this.hat(t, 0.16);
    }
    if (intensity >= 2) this.bell(t, chord + [12, 16, 19, 24][step % 4]!, 0.05);
  }

  // ---- instruments -------------------------------------------------------

  private env(t: number, peak: number, attack: number, decay: number, out: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(out);
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, out: AudioNode): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseBurst(t: number, dur: number, filterType: BiquadFilterType, freq: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    src.connect(f).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  private kick(t: number, vel: number): void {
    const g = this.env(t, 0.9 * vel, 0.002, 0.28, this.music);
    const o = this.osc('sine', 150, t, 0.3, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  }

  private snare(t: number): void {
    this.noiseBurst(t, 0.15, 'bandpass', 1800, this.env(t, 0.35, 0.002, 0.13, this.music));
    this.osc('triangle', 190, t, 0.1, this.env(t, 0.2, 0.002, 0.08, this.music));
  }

  private hat(t: number, vel: number): void {
    this.noiseBurst(t, 0.05, 'highpass', 7500, this.env(t, vel, 0.001, 0.04, this.music));
  }

  private bass(t: number, semis: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.2);
    f.connect(this.env(t, 0.28, 0.005, 0.22, this.music));
    this.osc('sawtooth', hz(semis), t, 0.25, f);
  }

  private pad(t: number, semis: number, dur: number): void {
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(this.music);
    for (const interval of [12, 16, 19]) {
      for (const detune of [-6, 6]) {
        const o = this.osc('sawtooth', hz(semis + interval), t, dur, f);
        o.detune.value = detune;
      }
    }
  }

  private bell(t: number, semis: number, vel: number): void {
    this.osc('sine', hz(semis + 12), t, 0.4, this.env(t, vel, 0.003, 0.35, this.music));
  }

  private footstep(t: number, weather: WeatherId): void {
    const freq = weather === 'rain' ? 1400 : weather === 'snow' ? 900 : 400;
    this.noiseBurst(t, 0.07, 'lowpass', freq, this.env(t, weather === 'dry' ? 0.12 : 0.2, 0.002, 0.06, this.sfx));
  }

  // ---- sound effects -----------------------------------------------------

  private now(): number | null {
    return this.ctx && this.ctx.state === 'running' ? this.ctx.currentTime : null;
  }

  jump(): void {
    const t = this.now();
    if (t === null) return;
    const o = this.osc('triangle', 300, t, 0.18, this.env(t, 0.18, 0.005, 0.16, this.sfx));
    o.frequency.exponentialRampToValueAtTime(720, t + 0.15);
  }

  land(j: Judgement): void {
    const t = this.now();
    if (t === null) return;
    this.osc('sine', 90, t, 0.15, this.env(t, 0.35, 0.002, 0.12, this.sfx));
    if (j === 'perfect') {
      [24, 28, 31, 36].forEach((s, i) => this.osc('sine', hz(s + 12), t + i * 0.03, 0.4, this.env(t + i * 0.03, 0.12, 0.003, 0.35, this.sfx)));
    } else if (j === 'good') {
      this.osc('sine', hz(36), t, 0.25, this.env(t, 0.1, 0.003, 0.2, this.sfx));
    }
  }

  collect(streak: number): void {
    const t = this.now();
    if (t === null) return;
    const scale = [0, 2, 4, 7, 9];
    const s = scale[streak % 5]! + 12 * Math.min(2, Math.floor(streak / 5));
    this.osc('triangle', hz(s + 36), t, 0.15, this.env(t, 0.12, 0.002, 0.12, this.sfx));
  }

  glide(): void {
    const t = this.now();
    if (t === null) return;
    this.noiseBurst(t, 0.6, 'bandpass', 900, this.env(t, 0.25, 0.1, 0.5, this.sfx));
    [12, 19, 24].forEach((s) => this.osc('sine', hz(s + 24), t, 0.8, this.env(t, 0.08, 0.1, 0.7, this.sfx)));
  }

  shoe(): void {
    const t = this.now();
    if (t === null) return;
    this.osc('square', 880, t, 0.04, this.env(t, 0.06, 0.001, 0.03, this.sfx));
    this.osc('square', 1320, t + 0.05, 0.04, this.env(t + 0.05, 0.06, 0.001, 0.03, this.sfx));
  }

  stumble(): void {
    const t = this.now();
    if (t === null) return;
    const o = this.osc('sawtooth', 160, t, 0.3, this.env(t, 0.25, 0.005, 0.25, this.sfx));
    o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
  }

  crash(): void {
    const t = this.now();
    if (t === null) return;
    this.noiseBurst(t, 0.5, 'lowpass', 1200, this.env(t, 0.6, 0.002, 0.45, this.sfx));
    const o = this.osc('sine', 120, t, 0.6, this.env(t, 0.6, 0.002, 0.55, this.sfx));
    o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
  }

  forecast(): void {
    const t = this.now();
    if (t === null) return;
    this.osc('sine', hz(43), t, 0.2, this.env(t, 0.1, 0.005, 0.18, this.sfx));
    this.osc('sine', hz(48), t + 0.12, 0.25, this.env(t + 0.12, 0.1, 0.005, 0.22, this.sfx));
  }

  /** Count-in tick on the beat; a higher chord on GO. */
  count(go: boolean): void {
    const t = this.now();
    if (t === null) return;
    const notes = go ? [24, 28, 31] : [19];
    for (const n of notes) this.osc('triangle', hz(n + 24), t, 0.2, this.env(t, 0.12, 0.003, 0.18, this.sfx));
  }

  whoosh(): void {
    const t = this.now();
    if (t === null) return;
    this.noiseBurst(t, 0.12, 'bandpass', 1600, this.env(t, 0.06, 0.01, 0.1, this.sfx));
  }

  slide(): void {
    const t = this.now();
    if (t === null) return;
    this.noiseBurst(t, 0.3, 'lowpass', 900, this.env(t, 0.12, 0.02, 0.26, this.sfx));
  }

  /** Approaching traffic: the Zürich tram's two-tone bell, or a bus horn. */
  vehicle(tram: boolean): void {
    const t = this.now();
    if (t === null) return;
    if (tram) {
      for (const offset of [0, 0.22]) {
        for (const f of [1568, 2350]) this.osc('sine', f, t + offset, 0.5, this.env(t + offset, 0.07, 0.002, 0.45, this.sfx));
      }
    } else {
      for (const f of [311, 392]) this.osc('sawtooth', f, t, 0.45, this.env(t, 0.05, 0.02, 0.4, this.sfx));
    }
  }

  /** Short rising flourish when entering a new zone. */
  zone(): void {
    const t = this.now();
    if (t === null) return;
    [12, 16, 19, 24].forEach((s, i) => this.osc('sine', hz(s + 24), t + i * 0.07, 0.35, this.env(t + i * 0.07, 0.08, 0.005, 0.3, this.sfx)));
  }
}
