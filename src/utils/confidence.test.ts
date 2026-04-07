import { describe, it, expect } from 'vitest'
import { calculateConfidence, getRateStability } from './confidence'

describe('calculateConfidence', () => {
  it('0h elapsed → low confidence, capped by minimumDataGuard', () => {
    // base = 0.15, paceDeviation = 0 → +0.05 bonus, but guard caps to 0.35
    const result = calculateConfidence(0, 168, 0, 0, 0)
    expect(result).toBeGreaterThanOrEqual(0.10)
    expect(result).toBeLessThanOrEqual(0.35)
  })

  it('48h with volatile pace → ~45-55%', () => {
    // recentPace=4.5, averagePace=3 → paceDeviation=0.5 > 0.30 → stabilityBonus=-0.08
    // base ≈ 0.562, result ≈ 0.482
    const result = calculateConfidence(48, 168, 150, 4.5, 3)
    expect(result).toBeGreaterThanOrEqual(0.45)
    expect(result).toBeLessThanOrEqual(0.55)
  })

  it('94h with neutral pace → ~72-78% (the originally broken case)', () => {
    // recentPace=3.5, averagePace=3 → paceDeviation=0.167 → neutral (no bonus)
    // base ≈ 0.746, result ≈ 0.746
    const result = calculateConfidence(94, 168, 300, 3.5, 3)
    expect(result).toBeGreaterThanOrEqual(0.72)
    expect(result).toBeLessThanOrEqual(0.78)
  })

  it('144h with stable pace → high confidence (≥88%)', () => {
    // paceDeviation = 0 → stabilityBonus = +0.05
    // base ≈ 0.903, result ≈ 0.953
    const result = calculateConfidence(144, 168, 500, 3.0, 3.0)
    expect(result).toBeGreaterThanOrEqual(0.88)
  })

  it('144h with highly volatile pace → penalised vs stable pace', () => {
    const stable = calculateConfidence(144, 168, 500, 3.0, 3.0)
    // recentPace=6, averagePace=3 → paceDeviation=1.0 > 0.30 → stabilityBonus=-0.08
    const volatile = calculateConfidence(144, 168, 500, 6.0, 3.0)
    expect(volatile).toBeLessThan(stable)
    // delta = 0.05 (stable bonus) + 0.08 (volatile penalty) = 0.13
    expect(stable - volatile).toBeCloseTo(0.13, 5)
  })
})

describe('getRateStability', () => {
  it('returns "stable" when deviation is < 10%', () => {
    expect(getRateStability(3.0, 3.0)).toBe('stable')
    expect(getRateStability(3.09, 3.0)).toBe('stable')
  })

  it('returns "unstable" when deviation is > 30%', () => {
    expect(getRateStability(4.0, 3.0)).toBe('unstable') // 33% deviation
    expect(getRateStability(1.0, 3.0)).toBe('unstable') // 67% deviation
  })

  it('returns "neutral" in the middle range', () => {
    expect(getRateStability(3.4, 3.0)).toBe('neutral') // 13% deviation
  })
})
