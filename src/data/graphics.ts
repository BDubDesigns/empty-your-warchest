import type { GameDataInput } from './schema';

export const graphics = {
  // Budget phone GPUs, by the name WebGL gives (Chrome on Android shows the real one). The Galaxy A15
  // (Mali-G57 MC2) is the floor phone of bench run 4: real shadows cost it half its 5% low fps.
  // - Mali: the T series and the small G cores (G31, G51, G52, G57), not the G6x/G7x ones.
  // - Adreno: 300 to 500 series, and the 605 to 613 of the Snapdragon 4/6 budget chips.
  // - PowerVR Rogue GE/GM: MediaTek's Helio A and P budget chips (not the Pixel 10's D-Series).
  // - SwiftShader and llvmpipe: no GPU at all, drawn in software.
  lowGpus: [
    String.raw`Mali-(T|G[35])\d`,
    String.raw`Adreno \(TM\) ([345]\d\d|60\d|61[0-3])\b`,
    String.raw`PowerVR Rogue G[EM]\d`,
    'SwiftShader',
    'llvmpipe',
  ],
  // Chrome rounds the memory it reports to a power of two (at most 8): 2 GB or less is a phone
  // that also struggles to hold the textures.
  lowMemoryGb: 2,
  // The woodcutting trees' old slow-phone rule, shared: a median frame over 25 ms (under 40 fps)
  // while aiming, judged over 90 frames.
  sampleFrames: 90,
  slowFrameMs: 25,
} satisfies GameDataInput['graphics'];
