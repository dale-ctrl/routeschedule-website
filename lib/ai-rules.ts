import Anthropic from '@anthropic-ai/sdk'
import type { OrderForRules } from './rules-engine'

interface AIDecision {
  id: string
  scheduledDay?: string | null
  priority?: number | null
  area?: string | null
  deliveryTime?: string | null
  blocked?: boolean
}

/**
 * Evaluate all ai_natural rules against the given orders using a single Claude call.
 * Applied after structured rules — only assigns a day if not already assigned.
 * Returns orders updated according to AI decisions.
 */
export async function applyAIRules(
  orders: OrderForRules[],
  aiRules: { name: string; description: string | null }[],
  apiKey: string
): Promise<OrderForRules[]> {
  if (orders.length === 0 || aiRules.length === 0 || !apiKey) return orders

  const rulesText = aiRules
    .map((r, i) => `Rule ${i + 1} — "${r.name}": ${r.description ?? '(no description)'}`)
    .join('\n')

  const ordersPayload = orders.map((o) => ({
    id: o.id,
    customer: o.customer,
    postcode: o.postcode,
    area: o.area ?? null,
    weight: o.weight,
    notes: o.notes ?? null,
    reference: o.reference ?? null,
    deliveryTime: o.deliveryTime ?? null,
    depot: o.depot ?? null,
    scheduledDay: o.scheduledDay ?? null,
  }))

  const prompt = `You are a delivery scheduling assistant for a UK logistics company.

Apply the following rules to each order and return your decisions.

RULES:
${rulesText}

ORDERS (${orders.length} total):
${JSON.stringify(ordersPayload, null, 2)}

Return a JSON array — one entry per order, in the same order as the input:
[
  {
    "id": "...",
    "scheduledDay": "monday|tuesday|wednesday|thursday|friday|saturday|null",
    "priority": 0-10 or null,
    "area": "string or null",
    "deliveryTime": "am|pm|null",
    "blocked": false
  }
]

Important:
- Only set scheduledDay if a rule requires it AND the order's current scheduledDay is null
- Set blocked=true if a rule says to block or exclude the order
- Set priority/area/deliveryTime if a rule changes them, otherwise null
- Return ONLY the JSON array with no other text`

  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content[0].type === 'text' ? message.content[0].text : ''
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return orders

    const decisions: AIDecision[] = JSON.parse(match[0])

    return orders.map((order) => {
      const d = decisions.find((x) => x.id === order.id)
      if (!d) return order

      const updated = { ...order }
      if (d.blocked) {
        updated.scheduledDay = 'blocked'
      } else {
        if (d.scheduledDay && !updated.scheduledDay) {
          updated.scheduledDay = d.scheduledDay
        }
        if (d.priority != null) updated.priority = d.priority
        if (d.area != null) updated.area = d.area
        if (d.deliveryTime != null) updated.deliveryTime = d.deliveryTime
      }
      return updated
    })
  } catch (err) {
    console.error('[AI rules] Evaluation error:', err)
    return orders
  }
}
