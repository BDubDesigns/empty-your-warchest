/** A unit with no spear left in the run's supply. */
export const UNARMED = 'unarmed';
/** A unit carrying a spear. */
export const ARMED = 'armed';

/** What a unit fights with: a spear, or nothing. */
export type Fighter = typeof ARMED | typeof UNARMED;

/** How many units carry a spear, and how many don't. */
export interface SquadCounts {
  unarmed: number;
  armed: number;
}

/**
 * The squad: its units by whether they carry a spear, and the spears still in the run's supply.
 * New recruits take a spear while there are any; extra recruits are unarmed.
 *
 * Spearmen lead the charge (decided Nov 24): fights and arrows hit the front line, armed first,
 * and the unarmed only once the spearmen are gone. So every fight is paid for in spearmen, and
 * extra bodies from a gate are a reserve, not a shield. Bad gates shed the unarmed extras first.
 */
export class Squad {
  #unarmed = 0;
  #armed = 0;
  #supply: number;
  #used = 0;

  /** A squad with `supply` spears to hand out. */
  constructor(supply: number) {
    this.#supply = Math.max(0, Math.floor(supply));
  }

  get count(): number {
    return this.#unarmed + this.#armed;
  }

  get armedCount(): number {
    return this.#armed;
  }

  get unarmed(): number {
    return this.#unarmed;
  }

  /** Spears handed out so far this run: what the run spends from the warchest. */
  get spearsUsed(): number {
    return this.#used;
  }

  /** Spears not yet handed out. */
  get supply(): number {
    return this.#supply;
  }

  snapshot(): SquadCounts {
    return { unarmed: this.#unarmed, armed: this.#armed };
  }

  /** Adds `n` recruits, each taking a spear while there are any. */
  recruit(n: number): void {
    const count = Math.max(0, Math.floor(n));
    const take = Math.min(count, this.#supply);
    this.#supply -= take;
    this.#armed += take;
    this.#used += take;
    this.#unarmed += count - take;
  }

  /** The next unit to fight (and fall): spearmen first, then the unarmed once none are left. */
  front(): Fighter | undefined {
    if (this.#armed > 0) return ARMED;
    return this.#unarmed > 0 ? UNARMED : undefined;
  }

  /** Removes up to `n` units from the front line (fights, arrows). Returns what each carried. */
  fall(n: number): Fighter[] {
    return this.#remove(n, () => this.front());
  }

  /** Removes up to `n` units, unarmed extras first (bad gates). Returns what each carried. */
  shed(n: number): Fighter[] {
    return this.#remove(n, () =>
      this.#unarmed > 0 ? UNARMED : this.#armed > 0 ? ARMED : undefined,
    );
  }

  #remove(n: number, next: () => Fighter | undefined): Fighter[] {
    const lost: Fighter[] = [];
    for (let i = 0; i < n; i++) {
      const fighter = next();
      if (fighter === undefined) break;
      if (fighter === UNARMED) this.#unarmed--;
      else this.#armed--;
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
    return this.shed(this.count - next);
  }

  clone(): Squad {
    const copy = new Squad(this.#supply);
    copy.#unarmed = this.#unarmed;
    copy.#armed = this.#armed;
    copy.#used = this.#used;
    return copy;
  }
}
