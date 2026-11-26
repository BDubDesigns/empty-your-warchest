import { byId, type GameData } from '../data';

/** "1 log", "6 staves", "0.6 staves": an item's name with a count, lower case. */
export function itemText(data: Pick<GameData, 'items'>, itemId: string, count: number): string {
  const name = byId(data.items, itemId).name.toLowerCase();
  const shown = Number.isInteger(count) ? String(count) : count.toFixed(1).replace(/\.0$/, '');
  return `${shown} ${name}${count === 1 ? '' : 's'}`;
}

/** An item's name for many of it, lower case: "logs". */
export function itemName(data: Pick<GameData, 'items'>, itemId: string): string {
  return `${byId(data.items, itemId).name.toLowerCase()}s`;
}
