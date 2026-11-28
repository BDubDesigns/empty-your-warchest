import type { GameDataInput } from './schema';

export const skills = [
  { id: 'woodcutting', name: 'Woodcutting' },
  { id: 'splitting', name: 'Splitting' },
  { id: 'firemaking', name: 'Firemaking' },
  { id: 'command', name: 'Command' },
  { id: 'alchemy', name: 'Alchemy' },
  { id: 'archery', name: 'Archery' },
  { id: 'fletching', name: 'Fletching' },
  { id: 'farming', name: 'Farming' },
] satisfies GameDataInput['skills'];
