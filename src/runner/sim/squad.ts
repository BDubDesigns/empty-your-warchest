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
 * take spears worst-first; extra recruits are unarmed.
 *
 * Spearmen lead the charge (decided Nov 24): fights and arrows hit the front line, armed first
 * (worst spear first), and the unarmed only once the spearmen are gone. So every fight is paid for
 * in spearmen, and extra bodies from a gate are a reserve, not a shield. Bad gates shed the
 * unarmed extras first.
 */
export class Squad {
  /** Spear qualities, worst to best. */
  readonly qualities: readonly string[];
  #unarmed = 0;
  readonly #armed = new Map<string, number>();
  readonly #supply = new Map<string, number>();
  readonly #used = new Map<string, number>();
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

  /** Spears handed out so far, by quality: what the run spends from the warchest. */
  get usedByQuality(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      this.qualities.map((quality) => [quality, this.#used.get(quality) ?? 0]),
    );
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
      this.#used.set(quality, (this.#used.get(quality) ?? 0) + take);
      this.#spearsUsed += take;
      left -= take;
    }
    this.#unarmed += left;
  }

  /** The next unit to fight (and fall): the worst spear, then the unarmed once no spears are left. */
  front(): Fighter | undefined {
    const armed = this.qualities.find((quality) => this.armed(quality) > 0);
    if (armed !== undefined) return armed;
    return this.#unarmed > 0 ? UNARMED : undefined;
  }

  /** Removes up to `n` units from the front line (fights, arrows). Returns what each carried. */
  fall(n: number): Fighter[] {
    return this.#remove(n, () => this.front());
  }

  /** Removes up to `n` units, unarmed extras first (bad gates). Returns what each carried. */
  shed(n: number): Fighter[] {
    return this.#remove(n, () =>
      this.#unarmed > 0 ? UNARMED : this.qualities.find((quality) => this.armed(quality) > 0),
    );
  }

  #remove(n: number, next: () => Fighter | undefined): Fighter[] {
    const lost: Fighter[] = [];
    for (let i = 0; i < n; i++) {
      const fighter = next();
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
    return this.shed(this.count - next);
  }

  clone(): Squad {
    const copy = new Squad(this.qualities, this.supply);
    copy.#unarmed = this.#unarmed;
    for (const [quality, count] of this.#armed) copy.#armed.set(quality, count);
    copy.#spearsUsed = this.#spearsUsed;
    for (const [quality, count] of this.#used) copy.#used.set(quality, count);
    return copy;
  }
}
