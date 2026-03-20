import { prisma } from '@/lib/prisma'

const SYSTEM_PROMPT = `You are a rules engine assistant for a UK delivery routing system. Convert a natural language rule description into a structured rule.

Available condition fields:
- postcode: UK postcode prefix (e.g. "PL1", "TR7", "EX31")
- area: Geographic area label
- customer: Customer/school name
- weight: Order weight in kg (numeric comparisons)
- notes: Order notes text
- reference: Order reference number
- deliveryTime: "am" or "pm"
- depot: Depot name (e.g. "Plymouth", "Andover")

Available operators: starts_with, contains, eq, ne, ends_with, gte, lte, in

Available actions:
- assign_day: Single day (value: monday/tuesday/wednesday/thursday/friday/saturday)
- assign_days: Multiple allowed days (value: comma-separated e.g. "tuesday,friday")
- set_priority: Priority 0-10, higher = loaded/routed first
- set_area: Set an area label on the order
- set_delivery_time: "am" or "pm"
- block: Block this order from being scheduled (value: "true")
- set_run_weight_limit: Max kg per truck run (numeric)
- set_min_truck_load: Min % truck fill before using second truck (numeric)
- assign_truck_type: Require a specific truck type (value: truck type name e.g. "Hiab", "Flatbed", "7.5T", "Refrigerated")

UK postcode geography — delivery area is south of the M4 corridor plus London within the M25.
Be specific with postcode districts, never use broad area codes unless the rule genuinely covers all of them.

SOUTH WEST:
- Plymouth city: PL1–PL7
- West Devon / Tavistock area: PL15–PL20 (Tavistock = PL19)
- South Hams: PL8, PL9, PL21 (Ivybridge)
- North Devon: EX31 (Barnstaple), EX32, EX33 (Braunton), EX34 (Ilfracombe), EX35 (Lynton), EX36 (S.Molton), EX37, EX38 (Torrington), EX39 (Bideford)
- Mid Devon: EX16 (Tiverton), EX17, EX18, EX19, EX20 (Okehampton)
- Exeter city: EX1–EX6
- East Devon: EX10–EX15, EX24
- South Devon: TQ1–TQ5 (Torquay/Paignton), TQ6–TQ9 (Dartmouth/Totnes), TQ10–TQ14 (Newton Abbot)
- Cornwall: TR1–TR20; TR7/TR8 (Newquay); PL22–PL26 (Bodmin/St Austell/Fowey)
- Somerset: TA1–TA24, BA1 (Bath), BA2–BA16
- Bristol: BS1–BS41
- Wiltshire: SN1–SN16 (Swindon), SP1–SP9 (Salisbury), SP10/SP11 (Andover)
- Dorset: BH1–BH25 (Bournemouth/Poole/Wimborne), DT1–DT11 (Dorchester/Weymouth/Bridport)
- Gloucestershire (south): GL1–GL20

SOUTH EAST:
- Hampshire: SO14–SO53 (Southampton/Winchester/Eastleigh), PO1–PO22 (Portsmouth/Chichester), GU11–GU35 (Aldershot/Farnham/Petersfield), RG21–RG29 (Basingstoke)
- Berkshire: RG1–RG20 (Reading/Newbury), SL1–SL9 (Slough/Windsor/Marlow)
- Oxfordshire (south): OX1–OX18, OX44, OX49
- Surrey: GU1–GU10 (Guildford), KT1–KT24 (Kingston/Epsom/Leatherhead), RH1–RH20 (Redhill/Crawley/Horsham), CR0–CR9 (Croydon), SM1–SM7 (Sutton/Cheam), TW1–TW20 (Twickenham/Staines)
- West Sussex: BN1–BN18 (Brighton/Worthing/Littlehampton), PO18–PO22 (Chichester), RH10–RH20 (Crawley/Horsham)
- East Sussex: BN20–BN27 (Eastbourne/Seaford), TN1–TN40 (Tunbridge Wells/Hastings)
- Kent: ME1–ME20 (Medway/Maidstone), CT1–CT21 (Canterbury/Thanet/Folkestone), TN1–TN40 (shared with E Sussex), DA1–DA18 (Dartford/Bexleyheath), BR1–BR8 (Bromley)

LONDON (within/below M25):
- Central: EC1–EC4, WC1–WC2
- West: W1–W14, SW1–SW20 (inc. all south-west London), TW (Twickenham/Richmond)
- South: SE1–SE28 (all south-east London), CR, BR, SM
- East: E1–E20, IG (Ilford), RM (Romford/Dagenham), DA (south)
- North (south of M25 boundary): N1–N22, NW1–NW11, EN1–EN5 (Enfield)

Key rules for accuracy:
- PL is Plymouth and surrounds — NOT North Devon
- EX alone is too broad — always use specific EX districts (e.g. EX31 not EX)
- North of Tavistock = EX31–EX39 (North Devon), not PL
- When a rule covers multiple postcode districts, use OR conditionLogic with one condition per prefix
- Prefer specific district codes (e.g. "EX31") over broad areas (e.g. "EX") unless the rule genuinely covers all
- If unsure which exact postcodes apply, include a note asking the user to verify

Rule types: area_day, weight, time_window, priority, block, truck_consolidation, general

Return ONLY valid JSON. If the rule can be structured, return:
{
  "structured": true,
  "name": "short rule name",
  "type": "area_day",
  "conditionLogic": "AND",
  "conditions": [{"field":"postcode","operator":"starts_with","value":"PL"}],
  "actions": [{"type":"assign_day","value":"wednesday"}],
  "description": "one-line explanation of what this rule does",
  "notes": "anything the user should double-check"
}

If the rule is too complex, ambiguous, or requires reasoning beyond field matching, return:
{
  "structured": false,
  "name": "short rule name",
  "description": "the rule written clearly as a complete instruction",
  "notes": "why it cannot be structured and what it will do"
}`

export async function POST(request: Request) {
  try {
    const { description } = await request.json() as { description: string }
    if (!description?.trim()) {
      return Response.json({ error: 'No rule description provided' }, { status: 400 })
    }

    const setting = await prisma.setting.findUnique({ where: { key: 'GROQ_API_KEY' } })
    const apiKey = setting?.value || process.env.GROQ_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'No Groq API key configured. Add it in Settings → AI Integration.' }, { status: 400 })
    }

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Convert this delivery rule: "${description}"` },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Groq API error ${res.status}: ${err}`)
    }

    const data = await res.json()
    const text: string = data.choices?.[0]?.message?.content ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return Response.json({ error: 'AI returned unexpected format' }, { status: 500 })

    const result = JSON.parse(jsonMatch[0])
    return Response.json(result)
  } catch (err) {
    console.error('[AI suggest]', err)
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500 })
  }
}
