import type { Inventory } from '../core';
import type { GameData } from '../data';

export interface WarchestRow {
  item: string;
  name: string;
  /** "12" for plain items; "Poor 4 · Good 2 · Perfect 1" for tiered ones. */
  detail: string;
}

/**
 * One row per item in the data, so new items show up in the warchest view automatically. Counts
 * come from anything that counts like the inventory (e.g. one holding back items still in flight).
 */
export function warchestRows(data: GameData, inventory: Pick<Inventory, 'count'>): WarchestRow[] {
  return data.items.map((item) => ({
    item: item.id,
    name: item.name,
    detail: item.tiered
      ? data.qualities
          .map((quality) => `${quality.name} ${inventory.count(item.id, quality.id)}`)
          .join(' · ')
      : String(inventory.count(item.id)),
  }));
}
