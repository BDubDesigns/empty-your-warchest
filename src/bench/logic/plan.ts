import type { BenchData, BenchPixelRatio } from '../../data/bench';

/** What one stress-test run draws, and how. */
export interface RunSettings {
  pack: string;
  scale: number;
  shadows: boolean;
  physics: boolean;
  matte: boolean;
  pixelRatio: BenchPixelRatio;
  note: string;
}

/** Run all's runs, each at `pixelRatio`. */
export function runAllPlan(data: BenchData, pixelRatio: BenchPixelRatio): RunSettings[] {
  return data.runAll.map((run) => ({ ...run, pixelRatio }));
}

/** The pixel ratio a choice comes to on a screen of `device` pixels per CSS pixel. */
export function pixelRatioFor(choice: BenchPixelRatio, device: number, gameMost: number): number {
  if (choice === 'game') return Math.min(device, gameMost);
  if (choice === 'device') return device;
  return choice;
}

/** A pixel ratio choice as shown: "Game (2)", "1.5", "Device (2.6)". */
export function pixelRatioLabel(choice: BenchPixelRatio, device: number, gameMost: number): string {
  const value = Math.round(pixelRatioFor(choice, device, gameMost) * 100) / 100;
  if (choice === 'game') return `Game (${String(value)})`;
  if (choice === 'device') return `Device (${String(value)})`;
  return String(value);
}

/** Roughly how long `runs` take (s), with `overhead` seconds each to load and warm up. */
export function planSeconds(runs: number, data: BenchData, overhead: number): number {
  return runs * (data.seconds + overhead);
}
