import { byId, type GameData, type Item } from '../data';

export interface Stack {
  item: string;
  count: number;
  /** Set for tiered items only. */
  quality?: string | undefined;
}

/**
 * Item counts, per quality tier for tiered items. No per-object tracking:
 * the warchest holds "12 Good spears", not 12 spear objects.
 */
export class Inventory {
  readonly #data: Pick<GameData, 'items' | 'qualities'>;
  readonly #counts = new Map<string, number>();

  constructor(data: Pick<GameData, 'items' | 'qualities'>, stacks: readonly Stack[] = []) {
    this.#data = data;
    for (const stack of stacks) this.add(stack.item, stack.count, stack.quality);
  }

  isTiered(itemId: string): boolean {
    return this.#item(itemId).tiered;
  }

  /** Count of one item. For a tiered item without a quality, the total across all tiers. */
  count(itemId: string, quality?: string): number {
    const item = this.#item(itemId);
    if (item.tiered && quality === undefined) {
      return this.#data.qualities.reduce((sum, q) => sum + this.count(itemId, q.id), 0);
    }
    return this.#counts.get(this.#key(item, quality)) ?? 0;
  }

  has(itemId: string, count: number, quality?: string): boolean {
    return this.count(itemId, quality) >= count;
  }

  add(itemId: string, count: number, quality?: string): void {
    this.#checkCount(count);
    const key = this.#key(this.#item(itemId), quality);
    this.#counts.set(key, (this.#counts.get(key) ?? 0) + count);
  }

  remove(itemId: string, count: number, quality?: string): void {
    this.#checkCount(count);
    const key = this.#key(this.#item(itemId), quality);
    const current = this.#counts.get(key) ?? 0;
    if (current < count) {
      throw new Error(
        `Not enough ${itemId}${quality ? ` (${quality})` : ''}: have ${current}, need ${count}`,
      );
    }
    if (current === count) this.#counts.delete(key);
    else this.#counts.set(key, current - count);
  }

  /** Non-empty stacks, in data order (items, then quality worst to best). */
  stacks(): Stack[] {
    const result: Stack[] = [];
    for (const item of this.#data.items) {
      const qualities = item.tiered ? this.#data.qualities.map((q) => q.id) : [undefined];
      for (const quality of qualities) {
        const count = this.#counts.get(this.#key(item, quality)) ?? 0;
        if (count > 0)
          result.push(quality ? { item: item.id, count, quality } : { item: item.id, count });
      }
    }
    return result;
  }

  #item(itemId: string): Item {
    return byId(this.#data.items, itemId);
  }

  #key(item: Item, quality: string | undefined): string {
    if (!item.tiered) {
      if (quality !== undefined) throw new Error(`"${item.id}" has no quality tiers`);
      return item.id;
    }
    if (quality === undefined) throw new Error(`"${item.id}" needs a quality tier`);
    byId(this.#data.qualities, quality);
    return `${item.id}:${quality}`;
  }

  #checkCount(count: number): void {
    if (!Number.isInteger(count) || count <= 0) {
      throw new RangeError(`Count must be a positive whole number, got ${count}`);
    }
  }
}
