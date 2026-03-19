export interface Condition {
  field: 'postcode' | 'area' | 'weight' | 'customer' | 'notes' | 'reference' | 'deliveryTime'
  operator: 'eq' | 'ne' | 'contains' | 'starts_with' | 'ends_with' | 'gte' | 'lte' | 'in'
  value: string | number | string[]
}

export interface Action {
  type: 'assign_day' | 'assign_days' | 'assign_truck' | 'set_priority' | 'block' | 'set_delivery_time' | 'set_area'
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
