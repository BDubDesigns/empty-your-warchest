import { describe, expect, it } from 'vitest';
import type { Screen } from '../src/app/screen';
import { ScreenSwitcher } from '../src/app/screenSwitcher';

function fakeScreen(name: string, log: string[]): Screen {
  return {
    mount: () => {
      log.push(`${name}:mount`);
      return Promise.resolve();
    },
    enter: () => log.push(`${name}:enter`),
    leave: () => log.push(`${name}:leave`),
  };
}

describe('ScreenSwitcher', () => {
  it('mounts each screen once and swaps between them', async () => {
    const log: string[] = [];
    const changes: string[] = [];
    const switcher = new ScreenSwitcher(
      { a: fakeScreen('a', log), b: fakeScreen('b', log) },
      (id) => changes.push(id),
    );

    await switcher.show('a');
    await switcher.show('b');
    await switcher.show('a');
    await switcher.show('a');

    expect(log).toEqual([
      'a:mount',
      'a:enter',
      'b:mount',
      'a:leave',
      'b:enter',
      'b:leave',
      'a:enter',
    ]);
    expect(changes).toEqual(['a', 'b', 'a']);
    expect(switcher.current).toBe('a');
  });

  it('keeps going after a screen fails to mount', async () => {
    const log: string[] = [];
    const broken: Screen = {
      ...fakeScreen('b', log),
      mount: () => Promise.reject(new Error('no WebGL')),
    };
    const switcher = new ScreenSwitcher({ a: fakeScreen('a', log), b: broken });

    await switcher.show('a');
    await expect(switcher.show('b')).rejects.toThrow('no WebGL');
    expect(switcher.current).toBe('a');
  });
});
