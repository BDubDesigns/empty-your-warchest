import type { Inventory } from '../core';
import type { GameData } from '../data';

export interface WarchestRow {
  item: string;
  name: string;
  /** The count, e.g. "12". */
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
    detail: String(inventory.count(item.id)),
  }));
}
