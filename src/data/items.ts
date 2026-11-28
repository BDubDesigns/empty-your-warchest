import type { GameDataInput } from './schema';

export const items = [
  { id: 'log', name: 'Log', look: 'round' },
  { id: 'stave', name: 'Stave', look: 'split' },
  { id: 'spear', name: 'Spear', look: 'pointed' },
  // Brewed at the cauldron (M9).
  { id: 'sense_potion', name: 'Sense potion', look: 'bottle' },
  // Brewing ingredients (M9): moss off mossy trees and boulders, red caps from mushroom trees and
  // patches, ash from the fire pit.
  { id: 'moss', name: 'Moss', look: 'tuft' },
  { id: 'red_cap', name: 'Red cap', look: 'cap' },
  { id: 'ash', name: 'Ash', look: 'heap' },
  // Blue for brewing: from farming one day; for now the starting stock and the debug menu.
  { id: 'woad', name: 'Woad', look: 'leaf' },
  // From the bird hunt (Archery): each bird's seeds (woad's seed is its own item, for farming
  // later), feathers for fletching, and the arrows it spends.
  { id: 'sunflower_seed', name: 'Sunflower seed', look: 'seed' },
  { id: 'woad_seed', name: 'Woad seed', look: 'pod' },
  { id: 'mushroom_spores', name: 'Mushroom spores', look: 'spores' },
  { id: 'feather', name: 'Feather', look: 'feather' },
  { id: 'fletched_arrow', name: 'Fletched arrow', look: 'arrow' },
  { id: 'bare_arrow', name: 'Bare arrow', look: 'shaft' },
  // Fletching: the bench's shortcut, the feather bucket, makes a feather duster of an arrow.
  { id: 'duster_arrow', name: 'Duster arrow', look: 'duster' },
] satisfies GameDataInput['items'];
