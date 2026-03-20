export interface Condition {
  field: 'postcode' | 'area' | 'weight' | 'customer' | 'notes' | 'reference' | 'deliveryTime' | 'depot'
  operator: 'eq' | 'ne' | 'contains' | 'starts_with' | 'ends_with' | 'gte' | 'lte' | 'in'
  value: string | number | string[]
}

export interface Action {
  type: 'assign_day' | 'assign_days' | 'assign_truck' | 'set_priority' | 'block' | 'set_delivery_time' | 'set_area' | 'set_run_weight_limit' | 'set_min_truck_load' | 'assign_truck_type'
  value: string | number
}

export interface ParsedRule {
  id: string
  name: string
  type: string
  conditionLogic: 'AND' | 'OR'
  conditions: Condition[]
  actions: Action[]
  priority: number
  active: boolean
}

export interface OrderForRules {
  id: string
  postcode: string
  area?: string | null
  weight: number
  customer: string
  notes?: string | null
  reference?: string | null
  deliveryTime?: string | null
  scheduledDay?: string | null
  priority: number
  depot?: string | null
  preferredTruckType?: string | null
}

function evaluateCondition(order: OrderForRules, condition: Condition): boolean {
  const raw = order[condition.field as keyof OrderForRules]
  const fieldValue = raw == null ? '' : String(raw)

  switch (condition.operator) {
    case 'eq':
      return fieldValue.toLowerCase() === String(condition.value).toLowerCase()
    case 'ne':
      return fieldValue.toLowerCase() !== String(condition.value).toLowerCase()
    case 'contains':
      return fieldValue.toLowerCase().includes(String(condition.value).toLowerCase())
    case 'starts_with':
      return fieldValue.toUpperCase().startsWith(String(condition.value).toUpperCase())
    case 'ends_with':
      return fieldValue.toUpperCase().endsWith(String(condition.value).toUpperCase())
    case 'gte':
      return Number(fieldValue) >= Number(condition.value)
    case 'lte':
      return Number(fieldValue) <= Number(condition.value)
    case 'in':
      return (condition.value as string[])
        .map((v) => v.toLowerCase())
        .includes(fieldValue.toLowerCase())
    default:
      return false
  }
}

function conditionsMatch(order: OrderForRules, conditions: Condition[], logic: 'AND' | 'OR'): boolean {
  if (conditions.length === 0) return true
  if (logic === 'OR') {
    return conditions.some((c) => evaluateCondition(order, c))
  }
  return conditions.every((c) => evaluateCondition(order, c))
}

export function applyRules(
  orders: OrderForRules[],
  rules: ParsedRule[]
): OrderForRules[] {
  const sortedRules = [...rules]
    .filter((r) => r.active)
    .sort((a, b) => b.priority - a.priority)

  return orders.map((order) => {
    let updated = { ...order }

    for (const rule of sortedRules) {
      const matches = conditionsMatch(updated, rule.conditions, rule.conditionLogic)
      if (!matches) continue

      for (const action of rule.actions) {
        switch (action.type) {
          case 'assign_day':
            // Only assign if not already assigned
            if (!updated.scheduledDay) {
              updated.scheduledDay = String(action.value)
            }
            break
          case 'assign_days':
            // Store multiple allowed days (comma-separated), e.g. "tuesday,friday"
            // Only assign if not already assigned
            if (!updated.scheduledDay) {
              updated.scheduledDay = String(action.value)
            }
            break
          case 'set_priority':
            updated.priority = Number(action.value)
            break
          case 'set_delivery_time':
            updated.deliveryTime = String(action.value)
            break
          case 'set_area':
            updated.area = String(action.value)
            break
          case 'assign_truck_type':
            if (!updated.preferredTruckType) {
              updated.preferredTruckType = String(action.value)
            }
            break
          case 'block':
            updated.scheduledDay = 'blocked'
            break
        }
      }
    }

    return updated
  })
}

export function parseRule(rule: {
  conditions: string
  actions: string
  id: string
  name: string
  type: string
  conditionLogic: string
  priority: number
  active: boolean
}): ParsedRule {
  return {
    ...rule,
    conditionLogic: (rule.conditionLogic === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR',
    conditions: JSON.parse(rule.conditions) as Condition[],
    actions: JSON.parse(rule.actions) as Action[],
  }
}

/** Check if a scheduledDay value includes a given day (supports comma-separated multi-day) */
export function orderMatchesDay(scheduledDay: string | null | undefined, day: string): boolean {
  if (!scheduledDay) return false
  return scheduledDay.split(',').map((d) => d.trim()).includes(day)
}

/**
 * Evaluate all active route_weight_limit rules against the batch of orders being routed.
 * A rule applies if it has no conditions, OR if any order in the batch matches its conditions.
 * Returns the lowest applicable weight limit in kg, or null if no rules apply.
 * The route generator should use min(truck.capacity, routeWeightLimit) for bin-packing.
 */
export function getRouteWeightLimit(
  rules: ParsedRule[],
  orders: OrderForRules[]
): number | null {
  const limitRules = rules.filter(
    (r) => r.active && r.actions.some((a) => a.type === 'set_run_weight_limit')
  )

  if (limitRules.length === 0) return null

  let minLimit: number | null = null

  for (const rule of limitRules) {
    // No conditions = always applies. Otherwise: applies if ANY order matches.
    const applies =
      rule.conditions.length === 0 ||
      orders.some((o) => conditionsMatch(o, rule.conditions, rule.conditionLogic))

    if (!applies) continue

    for (const action of rule.actions) {
      if (action.type === 'set_run_weight_limit') {
        const limit = Number(action.value)
        if (!isNaN(limit) && (minLimit === null || limit < minLimit)) {
          minLimit = limit
        }
      }
    }
  }

  return minLimit
}

/**
 * Evaluate all active truck consolidation rules.
 * Returns the highest (strictest) min-load percentage found, or null if no rules apply.
 * e.g. 70 means "don't dispatch a second truck unless the first would be at least 70% full".
 * The route optimizer uses this to cap the number of trucks to the minimum needed.
 */
export function getMinTruckLoadPct(
  rules: ParsedRule[],
  orders: OrderForRules[]
): number | null {
  const consolidationRules = rules.filter(
    (r) => r.active && r.actions.some((a) => a.type === 'set_min_truck_load')
  )

  if (consolidationRules.length === 0) return null

  let maxPct: number | null = null

  for (const rule of consolidationRules) {
    const applies =
      rule.conditions.length === 0 ||
      orders.some((o) => conditionsMatch(o, rule.conditions, rule.conditionLogic))

    if (!applies) continue

    for (const action of rule.actions) {
      if (action.type === 'set_min_truck_load') {
        const pct = Number(action.value)
        if (!isNaN(pct) && (maxPct === null || pct > maxPct)) {
          maxPct = pct
        }
      }
    }
  }

  return maxPct
}
