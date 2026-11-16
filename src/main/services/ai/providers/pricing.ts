import { z } from 'zod'
import raw from '../../../../../resources/data/model-prices.json'

/**
 * Built-in price hints for well-known models (resources/data/model-prices.json), used only when the provider
 * returns no price (PLAN 7.4). Shown as "estimated"; a user price in Settings wins over both.
 */
const PriceTableSchema = z.object({
  schemaVersion: z.literal(1),
  description: z.string().optional(),
  entries: z
    .array(
      z.strictObject({
        pattern: z.string().min(1),
        inPerMTok: z.number().nonnegative(),
        outPerMTok: z.number().nonnegative()
      })
    )
    .min(1)
})

let compiled: Array<{ pattern: RegExp; inPerMTok: number; outPerMTok: number }> | null = null

function table(): NonNullable<typeof compiled> {
  if (!compiled) {
    compiled = PriceTableSchema.parse(raw).entries.map((e) => ({
      pattern: new RegExp(e.pattern, 'i'),
      inPerMTok: e.inPerMTok,
      outPerMTok: e.outPerMTok
    }))
  }
  return compiled
}

/** Estimated price of a model from its id ("openai/gpt-4o" matches like "gpt-4o"), or undefined. */
export function priceFromHints(
  modelId: string
): { inPerMTok: number; outPerMTok: number } | undefined {
  const bare = modelId.slice(modelId.lastIndexOf('/') + 1)
  const hit = table().find((e) => e.pattern.test(bare))
  return hit ? { inPerMTok: hit.inPerMTok, outPerMTok: hit.outPerMTok } : undefined
}

/** Cost in USD of a request from token counts and a price, or undefined when either is unknown. */
export function costFromUsage(
  usage: { inputTokens?: number; outputTokens?: number },
  pricing: { inPerMTok: number; outPerMTok: number } | undefined
): number | undefined {
  if (!pricing || (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
    return undefined
  }
  return (
    ((usage.inputTokens ?? 0) * pricing.inPerMTok +
      (usage.outputTokens ?? 0) * pricing.outPerMTok) /
    1_000_000
  )
}
