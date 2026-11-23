import { describe, expect, it } from 'vitest';
import { LiveChoice, MemoryStore } from '../src/core';

const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
] as const;

describe('LiveChoice', () => {
  it('uses the default until something is picked, then keeps the pick on the device', () => {
    const store = new MemoryStore();
    const choice = new LiveChoice<'a' | 'b'>('key', 'Letters', options, 'a', store);
    expect(choice.value).toBe('a');
    expect(choice.picked).toBe(false);
    choice.set('b');
    expect(choice.value).toBe('b');
    expect(choice.picked).toBe(true);
    const reloaded = new LiveChoice<'a' | 'b'>('key', 'Letters', options, 'a', store);
    expect(reloaded.value).toBe('b');
    expect(reloaded.picked).toBe(true);
  });

  it('ignores a saved value that is no longer an option', () => {
    const store = new MemoryStore();
    store.set('key', 'gone');
    const choice = new LiveChoice<'a' | 'b'>('key', 'Letters', options, 'a', store);
    expect(choice.value).toBe('a');
    expect(choice.picked).toBe(false);
  });

  it('tells listeners only when the value changes', () => {
    const choice = new LiveChoice<'a' | 'b'>('key', 'Letters', options, 'a', new MemoryStore());
    const heard: string[] = [];
    choice.onChange((value) => heard.push(value));
    choice.set('a');
    choice.set('b');
    choice.set('b');
    expect(heard).toEqual(['b']);
    expect(choice.picked).toBe(true);
  });
});
