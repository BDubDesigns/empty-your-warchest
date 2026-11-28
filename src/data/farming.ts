import type { GameDataInput } from './schema';

// The farm (Farming, first slice). Every number is a first guess, meant to be tuned from playtest
// logs. Gauges run from 0 (dust dry) to 1 (soaked).
export const farming = {
  // 4 plots to start, more with Farming level.
  plots: [
    { level: 1, count: 4 },
    { level: 10, count: 6 },
    { level: 25, count: 8 },
  ],
  // Woad and sunflowers to start. Red caps in a shady log bed (from the crow's mushroom spores)
  // come later, with the moss bed.
  crops: [
    {
      // Thirsty: its band sits high. Blue leaves for Alchemy, the farm's only source of them.
      id: 'woad',
      name: 'Woad',
      seed: 'woad_seed',
      item: 'woad',
      level: 1,
      starter: 4,
      growMinutes: 10,
      yield: 3,
      xp: 4,
      band: { low: 0.62, high: 0.82 },
      look: {
        shape: 'rosette',
        leaf: '#4f7f7a',
        stem: '#3c6a52',
        flower: '#f0d23a',
        centre: '#f0d23a',
        plants: 4,
        height: 0.46,
      },
    },
    {
      // Less thirsty, and quicker. Its petals are the yellow for Alchemy (no brew needs one yet).
      id: 'sunflower',
      name: 'Sunflower',
      seed: 'sunflower_seed',
      item: 'sunflower_petals',
      level: 1,
      starter: 4,
      growMinutes: 6,
      yield: 2,
      xp: 5,
      band: { low: 0.34, high: 0.54 },
      look: {
        shape: 'stalk',
        leaf: '#5d9a34',
        stem: '#6f9a3a',
        flower: '#f6c21c',
        centre: '#5a3a1c',
        plants: 3,
        height: 0.95,
      },
    },
  ],
  watering: {
    // About 15–30 s: four plots take about 6 s of pouring, plus moving the can between them.
    seconds: 30,
    start: { min: 0.04, max: 0.18 },
    // Four plots' worth is 2.8 of a gauge: four woad plots need about 2.2 to reach their bands
    // and 2.9 to reach the top of them, so a careless pour leaves the last one dry.
    can: { perPlot: 0.7 },
    // 3 stars only with every plot in its band; 2 from half of them, 1 from a quarter.
    stars: { one: 0.25, two: 0.5, three: 1 },
    multiplier: { one: 1.25, two: 1.5, three: 2 },
    // 3 stars: half a seed back a plot, rounded down, so watering never makes seeds from nothing
    // (seeds come from birds).
    seedBonus: { three: 0.5 },
  },
  worker: { stars: 1 },
  looks: {
    plotSize: 1.5,
    plotGap: 0.42,
    columns: 2,
    bedHeight: 0.14,
    pitch: 56,
    fov: 38,
    margin: 0.45,
    stages: { sprout: 0.08, young: 0.35, grown: 0.7 },
    soil: { dry: '#b48a5c', wet: '#4e3420', mud: '#3b2a1e' },
    treeDistance: { min: 11, max: 22 },
    treeHeight: { min: 4, max: 7 },
    seed: 23,
    tiers: {
      high: { pixelRatio: 2, shadows: true, grass: true, furrows: true, trees: 18, drops: 36 },
      low: { pixelRatio: 1.5, shadows: false, grass: false, furrows: false, trees: 8, drops: 14 },
    },
  },
  feel: {
    // Woad's band is 0.2 wide: half a second of pouring; reaching it takes about 1.3 s.
    pourRate: 0.4,
    liftPx: 70,
    dryEndSeconds: 0.6,
    shakeStrength: 1,
    buzzPlantMs: 10,
    buzzBandMs: 18,
    buzzMudMs: 50,
    buzzHarvestMs: 14,
  },
} satisfies GameDataInput['farming'];
