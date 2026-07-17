/**
 * Deterministic random source for island generation — bit-exact port of the
 * Kotlin `PortableRandom` (game/PortableRandom.kt), which was itself designed
 * for JS portability: every operation is a wrapping 32-bit integer op
 * (Math.imul, >>>, | 0).
 *
 * DO NOT CHANGE ANYTHING in this class, and do not use any other random
 * source in generation code.
 *
 * Core: mulberry32 (public domain, Tommy Ettinger). One 32-bit state word:
 *   state = state + 0x6D2B79F5                  (wrapping add)
 *   z = (state xor (state >>> 15)) * (state or 1)
 *   z = z xor (z + (z xor (z >>> 7)) * (z or 61))
 *   output = z xor (z >>> 14)
 *
 * Derived draws (copied exactly from the Kotlin doc comment):
 *   nextInt(bound) = (unsigned64(output) * bound) >> 32
 *   nextBoolean()  = top bit of output set
 *   shuffled(list) = Fisher-Yates from the top:
 *                    for i = size-1 down to 1: swap(i, nextInt(i + 1))
 *
 * PortableRandomTest (Kotlin) / random.test.ts hold golden output vectors.
 */
export class PortableRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0;
  }

  /** Signed 32-bit result, identical to Kotlin's next(). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z = z ^ ((z + Math.imul(z ^ (z >>> 7), z | 61)) | 0);
    return (z ^ (z >>> 14)) | 0;
  }

  /**
   * nextInt(bound) = (uint64(uint32(next())) * bound) >> 32.
   *
   * The double-precision product (next() >>> 0) * bound is exact while it is
   * below 2^53, i.e. for every bound <= 2^21. The game's largest bound is 201
   * (role costs); hex-count bounds are < 100. Division by 2^32 is a power of
   * two (exact), so Math.floor reproduces the 64-bit shift bit-for-bit.
   */
  nextInt(bound: number): number {
    return Math.floor(((this.next() >>> 0) * bound) / 4294967296);
  }

  /** Top bit of next() set. */
  nextBoolean(): boolean {
    return this.next() < 0;
  }

  /** Fisher-Yates from the top: for i = size-1 down to 1: swap(i, nextInt(i+1)). */
  shuffled<T>(list: readonly T[]): T[] {
    const result = list.slice();
    for (let i = result.length - 1; i >= 1; i--) {
      const j = this.nextInt(i + 1);
      const tmp = result[i]!;
      result[i] = result[j]!;
      result[j] = tmp;
    }
    return result;
  }
}
