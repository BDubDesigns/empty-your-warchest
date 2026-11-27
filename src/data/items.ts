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
] satisfies GameDataInput['items'];
