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
