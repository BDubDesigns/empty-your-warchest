import type { Gate, GateOp } from '../../data';
import type { Squad } from './squad';

/** The squad count after passing a gate. Never below zero; dividing rounds up. */
export function applyGate(count: number, gate: Pick<Gate, 'op' | 'value'>): number {
  switch (gate.op) {
    case 'add':
      return count + gate.value;
    case 'subtract':
      return Math.max(0, count - gate.value);
    case 'multiply':
      return count * gate.value;
    case 'divide':
      return Math.ceil(count / gate.value);
  }
}

/** Good gates grow the squad (blue/green, ▲); bad ones shrink it (red, ▼). */
export function isGoodOp(op: GateOp): boolean {
  return op === 'add' || op === 'multiply';
}

const SYMBOLS: Record<GateOp, string> = { add: '+', subtract: '−', multiply: '×', divide: '÷' };

/** "+15", "×2", "−5", "÷2". */
export function gateLabel(gate: Pick<Gate, 'op' | 'value'>): string {
  return `${SYMBOLS[gate.op]}${gate.value}`;
}

export interface GatePreview {
  from: number;
  to: number;
  /** Armed units after the gate: a ×3 is only worth what you can arm. */
  armedTo: number;
}

/** What passing `gate` would do to the squad, without changing it. */
export function previewGate(squad: Squad, gate: Pick<Gate, 'op' | 'value'>): GatePreview {
  const after = squad.clone();
  after.resize(applyGate(squad.count, gate));
  return { from: squad.count, to: after.count, armedTo: after.armedCount };
}
