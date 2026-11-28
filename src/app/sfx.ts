/**
 * Plays short sound clips with Web Audio, for views outside Phaser. Clips load in the
 * background; the audio context starts on the first touch (browsers require one).
 */
export class Sfx {
  #context: AudioContext | undefined;
  readonly #clips = new Map<string, AudioBuffer>();
  readonly #pending = new Map<string, ArrayBuffer>();

  /** Fetches clips by name → URL. Decoding waits for the audio context. */
  load(clips: Record<string, string>): void {
    for (const [name, url] of Object.entries(clips)) {
      fetch(url)
        .then((response) => response.arrayBuffer())
        .then((bytes) => {
          this.#pending.set(name, bytes);
          this.#decodePending();
        })
        .catch((error: unknown) => {
          console.warn('Could not load sound', url, error);
        });
    }
  }

  /** Call from a touch handler: creates or resumes the audio context. */
  unlock(): void {
    this.#context ??= new AudioContext();
    if (this.#context.state === 'suspended') void this.#context.resume();
    this.#decodePending();
  }

  play(name: string, volume = 1, detuneCents = 0): void {
    const context = this.#context;
    const clip = this.#clips.get(name);
    if (!context || !clip) return;
    const source = context.createBufferSource();
    source.buffer = clip;
    source.detune.value = detuneCents;
    const gain = context.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(context.destination);
    source.start();
  }

  /**
   * A whoosh, made rather than loaded: a burst of noise through a band-pass filter sweeping down
   * from `from` to `to` Hz over `seconds` (an arrow leaving the bow, a swing).
   */
  whoosh(volume: number, seconds = 0.3, from = 2400, to = 500): void {
    const context = this.#context;
    if (!context || volume <= 0) return;
    const length = Math.max(Math.round(context.sampleRate * seconds), 1);
    const noise = context.createBuffer(1, length, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let index = 0; index < length; index++) samples[index] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = noise;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.2;
    const now = context.currentTime;
    band.frequency.setValueAtTime(from, now);
    band.frequency.exponentialRampToValueAtTime(to, now + seconds);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + seconds * 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + seconds);
    source.connect(band).connect(gain).connect(context.destination);
    source.start();
  }

  /**
   * A clip that plays on a loop (e.g. a fire's crackle), silent until its volume is set above 0.
   * It starts once the clip is ready, so set the volume every frame. `trim` seconds are skipped at
   * each end of the clip (mp3 pads both ends, which would click at the seam).
   */
  loop(name: string, trim = 0.05): SoundLoop {
    let source: AudioBufferSourceNode | undefined;
    let gain: GainNode | undefined;
    const start = (): boolean => {
      const context = this.#context;
      const clip = this.#clips.get(name);
      if (!context || !clip) return false;
      source = context.createBufferSource();
      source.buffer = clip;
      source.loop = true;
      source.loopStart = trim;
      source.loopEnd = Math.max(clip.duration - trim, trim + 0.1);
      gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(context.destination);
      source.start(0, trim);
      return true;
    };
    return {
      setVolume: (volume) => {
        if (!gain && (volume <= 0 || !start())) return;
        if (gain && this.#context) {
          gain.gain.setTargetAtTime(volume, this.#context.currentTime, 0.08);
        }
      },
      stop: () => {
        source?.stop();
        source = gain = undefined;
      },
    };
  }

  #decodePending(): void {
    const context = this.#context;
    if (!context) return;
    for (const [name, bytes] of this.#pending) {
      this.#pending.delete(name);
      context.decodeAudioData(bytes).then(
        (clip) => this.#clips.set(name, clip),
        (error: unknown) => {
          console.warn('Could not decode sound', name, error);
        },
      );
    }
  }
}

/** A looping sound: set its volume (0 for silent) every frame, and stop it when done. */
export interface SoundLoop {
  setVolume(volume: number): void;
  stop(): void;
}
