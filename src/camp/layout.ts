import { byId, type GameData } from '../data';

export type CampSpot =
  | {
      kind: 'station';
      id: string;
      name: string;
      skill: string;
      skillName: string;
      x: number;
      y: number;
    }
  | { kind: 'chest'; x: number; y: number };

/** Everything the camp shows and where, straight from the data. */
export function campSpots(data: GameData): CampSpot[] {
  return [
    ...data.stations.map((station): CampSpot => ({
      kind: 'station',
      id: station.id,
      name: station.name,
      skill: station.skill,
      skillName: byId(data.skills, station.skill).name,
      x: station.camp.x,
      y: station.camp.y,
    })),
    { kind: 'chest', ...data.camp.chest },
  ];
}
