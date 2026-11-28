import * as THREE from 'three';
import { drawSplitGrain } from '../../../app/woodGrain';
import { Rng } from '../../../core';

// The siege's drawn looks: block faces and their damage, the banner's cloth, dust, a whoosh and
// the alarm bell.

/** Darker as it takes damage. */
export function stageTint(color: number, stage: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(1 - stage * 0.17);
}

/**
 * The block faces, drawn once: dressed stone and planks, each at three stages of damage (whole,
 * cracked, crumbling), and the banner's cloth.
 */
export function makeTextures() {
  const canvas = (size: number) => {
    const element = document.createElement('canvas');
    element.width = element.height = size;
    const context = element.getContext('2d');
    if (!context) throw new Error('No 2D canvas');
    return { element, context };
  };
  const texture = (element: HTMLCanvasElement) => {
    const made = new THREE.CanvasTexture(element);
    made.colorSpace = THREE.SRGBColorSpace;
    made.anisotropy = 4;
    return made;
  };
  const rng = new Rng(5);
  const size = 128;
  /** Speckle, and a darker edge all round so every block reads on its own. */
  const face = (
    context: CanvasRenderingContext2D,
    base: string,
    grain: HTMLCanvasElement | undefined,
  ) => {
    context.fillStyle = base;
    context.fillRect(0, 0, size, size);
    if (grain) context.drawImage(grain, 0, 0, size, size);
    for (let index = 0; index < 900; index++) {
      const shade = rng.range(-30, 30);
      context.fillStyle = `rgba(${shade > 0 ? '255,255,255' : '0,0,0'},${String(Math.abs(shade) / 255)})`;
      context.fillRect(rng.int(0, size), rng.int(0, size), 2, 2);
    }
    const edge = context.createLinearGradient(0, 0, size, 0);
    for (const [at, alpha] of [
      [0, 0.45],
      [0.08, 0],
      [0.92, 0],
      [1, 0.45],
    ] as const) {
      edge.addColorStop(at, `rgba(30,24,18,${String(alpha)})`);
    }
    context.fillStyle = edge;
    context.fillRect(0, 0, size, size);
    const across = context.createLinearGradient(0, 0, 0, size);
    for (const [at, alpha] of [
      [0, 0.45],
      [0.1, 0],
      [0.9, 0],
      [1, 0.5],
    ] as const) {
      across.addColorStop(at, `rgba(30,24,18,${String(alpha)})`);
    }
    context.fillStyle = across;
    context.fillRect(0, 0, size, size);
  };
  /** Dark jagged cracks from the edges in; at the last stage chips knocked off the corners. */
  const damage = (context: CanvasRenderingContext2D, stage: number) => {
    context.strokeStyle = 'rgba(20,16,12,0.85)';
    context.lineCap = 'round';
    for (let crack = 0; crack < stage * 3; crack++) {
      context.lineWidth = rng.range(1.5, 3.5);
      context.beginPath();
      let x = rng.pick([0, size, rng.range(0, size)]);
      let y = x === 0 || x === size ? rng.range(0, size) : rng.pick([0, size]);
      context.moveTo(x, y);
      for (let step = 0; step < 6; step++) {
        x += rng.range(-22, 22) + (size / 2 - x) * 0.25;
        y += rng.range(-22, 22) + (size / 2 - y) * 0.25;
        context.lineTo(x, y);
      }
      context.stroke();
    }
    if (stage >= 2) {
      context.fillStyle = 'rgba(25,20,15,0.7)';
      for (let chip = 0; chip < 7; chip++) {
        const x = rng.pick([0, size]) + rng.range(-6, 6);
        const y = rng.range(0, size);
        context.beginPath();
        context.ellipse(x, y, rng.range(5, 14), rng.range(4, 10), rng.range(0, 3), 0, Math.PI * 2);
        context.fill();
      }
    }
  };
  const staged = (base: string, grain: () => HTMLCanvasElement | undefined) =>
    [0, 1, 2].map((stage) => {
      const { element, context } = canvas(size);
      face(context, base, grain());
      damage(context, stage);
      return texture(element);
    });
  const stone = staged('#c9c4b8', () => undefined);
  const wood = staged('#d9b88a', () => {
    const grain = drawSplitGrain(32, 128, 6, 3);
    return grain;
  });
  const { element, context } = canvas(128);
  context.fillStyle = '#b3261e';
  context.fillRect(0, 0, 128, 128);
  context.fillStyle = '#f0cd5c';
  context.fillRect(0, 0, 128, 10);
  context.fillRect(0, 118, 128, 10);
  // A crossed pair of spears: the warband's mark.
  context.strokeStyle = '#f0cd5c';
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(30, 100);
  context.lineTo(98, 28);
  context.moveTo(98, 100);
  context.lineTo(30, 28);
  context.stroke();
  return { stone, wood, banner: texture(element) };
}

export function puffTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2D canvas');
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A spear's whoosh, made rather than recorded: a short burst of noise swelling and dying away,
 * low-passed more as it fades, as a WAV in memory (no file to ship or credit).
 */
export function whooshUrl(): string {
  const rate = 22050;
  const length = Math.round(rate * 0.32);
  const data = new Int16Array(length);
  const rng = new Rng(3);
  let low = 0;
  for (let index = 0; index < length; index++) {
    const t = index / length;
    const envelope = Math.sin(Math.PI * t) ** 2;
    const cutoff = 0.35 - 0.28 * t;
    low += (rng.range(-1, 1) - low) * cutoff;
    data[index] = Math.round(low * envelope * 0.9 * 32767);
  }
  return wavUrl(data, rate);
}

/**
 * The alarm bell's toll, made rather than recorded (a stand-in for a real recording): a big
 * bronze bell's inharmonic partials (the hum an octave under its strike note, the minor third, the
 * fifth and the rest), each ringing on and dying away at its own rate, the high ones soonest, and
 * a sharp strike at the start.
 */
export function bellUrl(): string {
  const rate = 22050;
  const seconds = 3.2;
  const length = Math.round(rate * seconds);
  const data = new Float32Array(length);
  const strike = 392;
  // (share of the strike note, loudness, seconds to die away to a third)
  const partials: [number, number, number][] = [
    [0.5, 0.55, 2.6],
    [1, 0.8, 1.8],
    [1.2, 0.45, 1.4],
    [1.5, 0.3, 1.1],
    [2, 0.35, 0.9],
    [2.51, 0.2, 0.6],
    [2.66, 0.18, 0.55],
    [3.01, 0.12, 0.4],
  ];
  let most = 0;
  for (let index = 0; index < length; index++) {
    const t = index / rate;
    let sample = 0;
    for (const [share, loud, decay] of partials) {
      sample += loud * Math.exp(-t / decay) * Math.sin(2 * Math.PI * strike * share * t);
    }
    // The strike: a few milliseconds of clang.
    sample *= Math.min(t / 0.004, 1);
    data[index] = sample;
    most = Math.max(most, Math.abs(sample));
  }
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index++) {
    pcm[index] = Math.round(((data[index] ?? 0) / (most || 1)) * 0.9 * 32767);
  }
  return wavUrl(pcm, rate);
}

/** 16-bit mono samples as a WAV in memory. */
function wavUrl(data: Int16Array, rate: number): string {
  const length = data.length;
  const header = new DataView(new ArrayBuffer(44));
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      header.setUint8(at + index, value.charCodeAt(index));
    }
  };
  text(0, 'RIFF');
  header.setUint32(4, 36 + length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, 'data');
  header.setUint32(40, length * 2, true);
  return URL.createObjectURL(
    new Blob([header.buffer, data.buffer as ArrayBuffer], { type: 'audio/wav' }),
  );
}
