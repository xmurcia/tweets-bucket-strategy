export function calculateConfidence(
  elapsedHours: number,
  totalHours: number,
  tweetsAccumulated: number,
  recentPace: number,   // tweets/hr over the last 12h
  averagePace: number   // tweets/hr over the full period
): number {
  const timeRatio = totalHours > 0 ? elapsedHours / totalHours : 0
  const baseConfidence = Math.min(0.97, 0.15 + 0.82 * Math.pow(timeRatio, 0.55))

  const paceDeviation = Math.abs(recentPace - averagePace) / (averagePace || 1)
  let stabilityBonus = 0
  if (paceDeviation < 0.10) stabilityBonus = 0.05
  else if (paceDeviation > 0.30) stabilityBonus = -0.08

  // Do not exceed 40% before 24h of data
  const minimumDataGuard = elapsedHours < 24 ? 0.35 : 0.97

  return Math.min(minimumDataGuard, Math.max(0.10, baseConfidence + stabilityBonus))
}

export function getRateStability(
  recentPace: number,
  averagePace: number
): 'stable' | 'unstable' | 'neutral' {
  const paceDeviation = Math.abs(recentPace - averagePace) / (averagePace || 1)
  if (paceDeviation < 0.10) return 'stable'
  if (paceDeviation > 0.30) return 'unstable'
  return 'neutral'
}
