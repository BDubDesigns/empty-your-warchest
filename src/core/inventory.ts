import { byId, type GameData } from '../data';

export interface Stack {
  item: string;
  count: number;
}

/**
 * Item counts. No per-object tracking: the warchest holds "12 spears", not 12 spear objects.
 */
export class Inventory {
  readonly #data: Pick<GameData, 'items'>;
  readonly #counts = new Map<string, number>();

  constructor(data: Pick<GameData, 'items'>, stacks: readonly Stack[] = []) {
    this.#data = data;
    for (const stack of stacks) this.add(stack.item, stack.count);
  }

  count(itemId: string): number {
    return this.#counts.get(this.#id(itemId)) ?? 0;
  }

  has(itemId: string, count: number): boolean {
    return this.count(itemId) >= count;
  }

  add(itemId: string, count: number): void {
    this.#checkCount(count);
    const id = this.#id(itemId);
    this.#counts.set(id, (this.#counts.get(id) ?? 0) + count);
  }

  remove(itemId: string, count: number): void {
    this.#checkCount(count);
    const id = this.#id(itemId);
    const current = this.#counts.get(id) ?? 0;
    if (current < count) {
      throw new Error(`Not enough ${itemId}: have ${current}, need ${count}`);
    }
    if (current === count) this.#counts.delete(id);
    else this.#counts.set(id, current - count);
  }

  /** Non-empty stacks, in data order. */
  stacks(): Stack[] {
    const result: Stack[] = [];
    for (const item of this.#data.items) {
      const count = this.#counts.get(item.id) ?? 0;
      if (count > 0) result.push({ item: item.id, count });
    }
    return result;
  }

  /** The item's id, throwing if the data has no such item. */
  #id(itemId: string): string {
    return byId(this.#data.items, itemId).id;
  }

  #checkCount(count: number): void {
    if (!Number.isInteger(count) || count <= 0) {
      throw new RangeError(`Count must be a positive whole number, got ${count}`);
    }
  }
}
