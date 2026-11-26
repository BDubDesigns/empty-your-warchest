import type { GameDataInput } from './schema';

// `camp` places the station in the camp: x and y as fractions of the portrait screen.
export const stations = [
  {
    id: 'tree_line',
    name: 'Tree line',
    skill: 'woodcutting',
    mechanic: 'woodcutting3d',
    camp: { x: 0.27, y: 0.2 },
  },
  {
    id: 'workbench',
    name: 'Workbench',
    skill: 'splitting',
    mechanic: 'splitting',
    camp: { x: 0.27, y: 0.42 },
  },
  {
    id: 'fire_pit',
    name: 'Fire pit',
    skill: 'firemaking',
    mechanic: 'firemaking',
    camp: { x: 0.73, y: 0.42 },
  },
  {
    id: 'war_tent',
    name: 'War tent',
    skill: 'command',
    mechanic: 'siege',
    camp: { x: 0.5, y: 0.82 },
  },
] satisfies GameDataInput['stations'];
