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
    // Top right, across from the Tree line (M9). The camp scrolls one day; it stays in data.
    id: 'cauldron',
    name: 'Cauldron',
    skill: 'alchemy',
    mechanic: 'brewing',
    camp: { x: 0.73, y: 0.2 },
  },
  {
    // At the forest edge (Archery): the left of the middle row, the chest moved over to the right
    // to make room.
    id: 'hunting_stand',
    name: 'Hunting stand',
    skill: 'archery',
    mechanic: 'archery',
    camp: { x: 0.27, y: 0.62 },
  },
  {
    // Right beside the hunting stand (Brandon, Nov 27), where the chest was: the chest and the
    // War tent share the bottom row now.
    id: 'fletchers_bench',
    name: "Fletcher's bench",
    skill: 'fletching',
    mechanic: 'fletching',
    camp: { x: 0.73, y: 0.62 },
  },
  {
    id: 'war_tent',
    name: 'War tent',
    skill: 'command',
    mechanic: 'siege',
    camp: { x: 0.27, y: 0.82 },
  },
] satisfies GameDataInput['stations'];
