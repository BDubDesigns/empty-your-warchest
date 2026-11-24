/** A unit with no spear left in the run's supply. */
export const UNARMED = 'unarmed';

/** What a unit fights with: `UNARMED` or a spear quality id. */
export type Fighter = string;

/** How many units carry each spear quality, plus the unarmed. */
export interface SquadCounts {
  unarmed: number;
  armed: Readonly<Record<string, number>>;
}

/**
 * The squad: its units by what they carry, and the spears still in the run's supply. New recruits
 * take spears worst-first; extra recruits are unarmed. Losses take the unarmed first (they soak up
 * hits), then the worst spears, so the best ones last.
 */
export class Squad {
  /** Spear qualities, worst to best. */
  readonly qualities: readonly string[];
  #unarmed = 0;
  readonly #armed = new Map<string, number>();
  readonly #supply = new Map<string, number>();
  #spearsUsed = 0;

  constructor(qualities: readonly string[], supply: Readonly<Record<string, number>>) {
    this.qualities = qualities;
    for (const quality of qualities) {
      this.#armed.set(quality, 0);
      this.#supply.set(quality, Math.max(0, Math.floor(supply[quality] ?? 0)));
    }
  }

  get count(): number {
    return this.#unarmed + this.armedCount;
  }

  get armedCount(): number {
    let armed = 0;
    for (const count of this.#armed.values()) armed += count;
    return armed;
  }

  get unarmed(): number {
    return this.#unarmed;
  }

  /** Spears handed out so far this run. */
  get spearsUsed(): number {
    return this.#spearsUsed;
  }

  /** Spears not yet handed out, by quality. */
  get supply(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.#supply);
  }

  armed(quality: string): number {
    return this.#armed.get(quality) ?? 0;
  }

  snapshot(): SquadCounts {
    return { unarmed: this.#unarmed, armed: Object.fromEntries(this.#armed) };
  }

  /** Adds `n` recruits, each taking the worst spear left, if any. */
  recruit(n: number): void {
    let left = Math.max(0, Math.floor(n));
    for (const quality of this.qualities) {
      const take = Math.min(left, this.#supply.get(quality) ?? 0);
      if (take === 0) continue;
      this.#supply.set(quality, (this.#supply.get(quality) ?? 0) - take);
      this.#armed.set(quality, this.armed(quality) + take);
      this.#spearsUsed += take;
      left -= take;
    }
    this.#unarmed += left;
  }

  /** The next unit to fight (and fall): unarmed first, then the worst spear. */
  front(): Fighter | undefined {
    if (this.#unarmed > 0) return UNARMED;
    return this.qualities.find((quality) => this.armed(quality) > 0);
  }

  /** Removes up to `n` units in fighting order. Returns what each one carried. */
  lose(n: number): Fighter[] {
    const lost: Fighter[] = [];
    for (let i = 0; i < n; i++) {
      const fighter = this.front();
      if (fighter === undefined) break;
      if (fighter === UNARMED) this.#unarmed--;
      else this.#armed.set(fighter, this.armed(fighter) - 1);
      lost.push(fighter);
    }
    return lost;
  }

  /** Sets the count to `target`, recruiting or losing units as needed. */
  resize(target: number): Fighter[] {
    const next = Math.max(0, Math.floor(target));
    if (next >= this.count) {
      this.recruit(next - this.count);
      return [];
    }
    return this.lose(this.count - next);
  }

  clone(): Squad {
    const copy = new Squad(this.qualities, this.supply);
    copy.#unarmed = this.#unarmed;
    for (const [quality, count] of this.#armed) copy.#armed.set(quality, count);
    copy.#spearsUsed = this.#spearsUsed;
    return copy;
  }
}
