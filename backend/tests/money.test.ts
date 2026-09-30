import { describe, it, expect } from 'vitest';
import {
  toPaise,
  rupeesToPaise,
  paiseToRupees,
  addPaise,
  subtractPaise,
  formatINR,
  isPaise,
} from '../src/lib/money.js';

describe('money (integer paise)', () => {
  it('converts rupees to paise without float drift', () => {
    expect(rupeesToPaise(0.1) + rupeesToPaise(0.2)).toBe(30); // the classic 0.1+0.2 trap
    expect(rupeesToPaise(199.99)).toBe(19999);
    expect(rupeesToPaise(1)).toBe(100);
  });

  it('round-trips paise <-> rupees', () => {
    expect(paiseToRupees(toPaise(19999))).toBe(199.99);
  });

  it('adds and subtracts safely', () => {
    expect(addPaise(toPaise(1000), toPaise(2050), toPaise(5))).toBe(3055);
    expect(subtractPaise(toPaise(5000), toPaise(1500))).toBe(3500);
  });

  it('rejects invalid money', () => {
    expect(() => toPaise(10.5)).toThrow();
    expect(() => toPaise(-1)).toThrow();
    expect(() => subtractPaise(toPaise(100), toPaise(200))).toThrow(); // no negative balance
    expect(isPaise(10.5)).toBe(false);
    expect(isPaise(1000)).toBe(true);
  });

  it('formats as INR', () => {
    expect(formatINR(toPaise(152340))).toBe('₹1,523.40');
  });
});
