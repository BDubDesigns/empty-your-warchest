import type { GameDataInput } from './schema';

export const skills = [
  { id: 'woodcutting', name: 'Woodcutting' },
  { id: 'fletching', name: 'Fletching' },
  { id: 'command', name: 'Command' },
] satisfies GameDataInput['skills'];
