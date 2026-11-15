import type { ModelInfo } from '@shared/ai/types'

export type CostTier = 1 | 2 | 3

export interface CostTierThresholds {
  /** Blended $/1M tokens below which a model is `$`. */
  low: number
  /** Blended $/1M tokens above which a model is `$$$`. */
  high: number
}

/** PLAN 7.4: `$` < $1, `$$` $1-$10, `$$$` > $10 (editable in Settings later). */
export const DEFAULT_COST_TIER_THRESHOLDS: CostTierThresholds = { low: 1, high: 10 }

/** Blended price per 1M tokens, `(input + 3 x output) / 4` (agent turns are output-heavy). */
export function blendedPricePerMTok(pricing: { inPerMTok: number; outPerMTok: number }): number {
  return (pricing.inPerMTok + 3 * pricing.outPerMTok) / 4
}

/** Cost tier from a model's prices, or undefined when the price is unknown (the badge is hidden, never guessed). */
export function costTierFor(
  pricing: ModelInfo['pricing'] | { inPerMTok: number; outPerMTok: number } | undefined,
  thresholds: CostTierThresholds = DEFAULT_COST_TIER_THRESHOLDS
): CostTier | undefined {
  if (!pricing) return undefined
  const { inPerMTok, outPerMTok } = pricing
  if (![inPerMTok, outPerMTok].every((v) => Number.isFinite(v) && v >= 0)) return undefined
  const blended = blendedPricePerMTok(pricing)
  if (blended < thresholds.low) return 1
  if (blended <= thresholds.high) return 2
  return 3
}
