import type { GameDataInput } from './schema';

export const skills = [
  { id: 'woodcutting', name: 'Woodcutting' },
  { id: 'splitting', name: 'Splitting' },
  { id: 'firemaking', name: 'Firemaking' },
  { id: 'command', name: 'Command' },
  { id: 'alchemy', name: 'Alchemy' },
  { id: 'archery', name: 'Archery' },
] satisfies GameDataInput['skills'];
