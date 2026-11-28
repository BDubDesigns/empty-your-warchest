import { describe, expect, it } from 'vitest';
import { LeaveGuard, countOf, type LeavePrompt } from '../src/app/leaveGuard';
import { PhoneBack, type HistoryLike } from '../src/app/phoneBack';

function setupGuard(cost: string | undefined) {
  const state = { cost, left: 0, shown: [] as string[], hidden: 0 };
  const logged: { type: string; data: Record<string, unknown> }[] = [];
  let answer: ((leave: boolean) => void) | undefined;
  const prompt: LeavePrompt = {
    show(text, onAnswer) {
      state.shown.push(text);
      answer = onAnswer;
    },
    hide() {
      state.hidden += 1;
    },
  };
  const guard = new LeaveGuard({
    cost: () => state.cost,
    where: () => 'archery',
    prompt,
    leave: () => {
      state.left += 1;
    },
    log: (type, data) => logged.push({ type, data }),
  });
  return {
    guard,
    state,
    logged,
    answer: (leave: boolean) => {
      answer?.(leave);
    },
  };
}

describe('LeaveGuard', () => {
  it('leaves at once, with no card, when nothing would be lost', () => {
    const { guard, state, logged } = setupGuard(undefined);
    guard.request();
    expect(state.left).toBe(1);
    expect(state.shown).toEqual([]);
    expect(logged).toEqual([]);
  });

  it('asks first when something would be lost, and Keep playing stays', () => {
    const { guard, state, logged, answer } = setupGuard('Your brew is lost.');
    guard.request();
    expect(state.shown).toEqual(['Your brew is lost.']);
    expect(state.left).toBe(0);
    expect(guard.asking).toBe(true);
    answer(false);
    expect(state.left).toBe(0);
    expect(guard.asking).toBe(false);
    expect(logged).toEqual([
      {
        type: 'app.leaveAsk',
        data: { station: 'archery', lost: 'Your brew is lost.', confirmed: false },
      },
    ]);
  });

  it('leaves once Leave is chosen, and logs it', () => {
    const { guard, state, logged, answer } = setupGuard('Your brew is lost.');
    guard.request();
    answer(true);
    expect(state.left).toBe(1);
    expect(logged[0]?.data.confirmed).toBe(true);
  });

  it('asks once however often Back to camp is tapped, and answers only once', () => {
    const { guard, state, answer } = setupGuard('x');
    guard.request();
    guard.request();
    expect(state.shown).toHaveLength(1);
    answer(true);
    answer(true);
    expect(state.left).toBe(1);
  });

  it("the phone's back is logged, and asks like the button", () => {
    const { guard, state, logged } = setupGuard('x');
    guard.phoneBack();
    expect(state.shown).toEqual(['x']);
    expect(logged[0]).toEqual({
      type: 'app.backButton',
      data: { station: 'archery', asking: false },
    });
  });

  it("the phone's back with nothing to lose leaves", () => {
    const { guard, state } = setupGuard(undefined);
    guard.phoneBack();
    expect(state.left).toBe(1);
  });

  it("the phone's back with the card up counts as Keep playing", () => {
    const { guard, state, logged } = setupGuard('x');
    guard.request();
    guard.phoneBack();
    expect(state.left).toBe(0);
    expect(guard.asking).toBe(false);
    expect(logged.map((entry) => entry.type)).toEqual(['app.backButton', 'app.leaveAsk']);
    expect(logged[1]?.data.confirmed).toBe(false);
  });

  it('dismiss hides the card without logging an answer', () => {
    const { guard, state, logged } = setupGuard('x');
    guard.request();
    guard.dismiss();
    expect(guard.asking).toBe(false);
    expect(state.hidden).toBe(1);
    expect(logged).toEqual([]);
  });
});

describe('countOf', () => {
  it('pluralises', () => {
    expect(countOf(1, 'spear')).toBe('1 spear');
    expect(countOf(12, 'spear')).toBe('12 spears');
  });
});

describe('PhoneBack', () => {
  function setupBack() {
    const calls: string[] = [];
    const history: HistoryLike = {
      pushState: () => calls.push('push'),
      back: () => calls.push('back'),
    };
    let presses = 0;
    const phone = new PhoneBack(history, () => {
      presses += 1;
    });
    return { phone, calls, presses: () => presses };
  }

  it('pushes one entry on leaving the camp and pops it on return', () => {
    const { phone, calls } = setupBack();
    phone.follow(true);
    phone.follow(true);
    expect(calls).toEqual(['push']);
    phone.follow(false);
    expect(calls).toEqual(['push', 'back']);
    // The pop it asked for isn't the player's back.
    phone.popped(false);
    phone.follow(true);
    expect(calls).toEqual(['push', 'back', 'push']);
  });

  it('at the camp it does nothing, so back is the browser’s own', () => {
    const { phone, calls, presses } = setupBack();
    phone.follow(false);
    phone.popped(false);
    expect(calls).toEqual([]);
    expect(presses()).toBe(0);
  });

  it('puts its entry back when back pops it, and reports the press', () => {
    const { phone, calls, presses } = setupBack();
    phone.follow(true);
    phone.popped(true);
    expect(calls).toEqual(['push', 'push']);
    expect(presses()).toBe(1);
    expect(phone.entry).toBe(true);
  });
});
