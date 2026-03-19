'use client'

import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Input'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Zap } from 'lucide-react'

interface Rule {
  id: string
  name: string
  description: string | null
  type: string
  conditionLogic: string
  conditions: string
  actions: string
  priority: number
  active: boolean
  createdAt: string
}

interface Condition {
  field: string
  operator: string
  value: string
}

interface Action {
  type: string
  value: string
}

const CONDITION_FIELDS = [
  { value: 'postcode', label: 'Postcode' },
  { value: 'area', label: 'Area' },
  { value: 'customer', label: 'Customer Name' },
  { value: 'weight', label: 'Weight (kg)' },
  { value: 'notes', label: 'Notes' },
  { value: 'reference', label: 'Reference' },
]

const OPERATORS = [
  { value: 'starts_with', label: 'Starts with' },
  { value: 'contains', label: 'Contains' },
  { value: 'eq', label: 'Equals' },
  { value: 'ne', label: 'Does not equal' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'gte', label: 'Greater than or equal (numbers)' },
  { value: 'lte', label: 'Less than or equal (numbers)' },
]

const ACTION_TYPES = [
  { value: 'assign_day', label: 'Assign to single day' },
  { value: 'assign_days', label: 'Assign to multiple allowed days' },
  { value: 'set_run_weight_limit', label: 'Set max weight per truck run (kg)' },
  { value: 'set_area', label: 'Set area label' },
  { value: 'set_priority', label: 'Set priority (0–10)' },
  { value: 'set_delivery_time', label: 'Set delivery time' },
  { value: 'block', label: 'Block order (do not schedule)' },
]

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const RULE_TYPES = [
  { value: 'area_day', label: 'Area / Day Assignment' },
  { value: 'route_weight_limit', label: 'Route Weight Limit (per truck run)' },
  { value: 'weight', label: 'Order Weight Rule' },
  { value: 'time_window', label: 'Time Window' },
  { value: 'priority', label: 'Priority Rule' },
  { value: 'block', label: 'Block Rule' },
  { value: 'general', label: 'General' },
]

const emptyRule = {
  name: '',
  description: '',
  type: 'area_day',
  conditionLogic: 'AND' as 'AND' | 'OR',
  priority: 0,
  active: true,
  conditions: [{ field: 'postcode', operator: 'starts_with', value: '' }] as Condition[],
  actions: [{ type: 'assign_day', value: 'monday' }] as Action[],
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState(false)
  const [editingRule, setEditingRule] = useState<typeof emptyRule | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchRules = useCallback(() => {
    setLoading(true)
    fetch('/api/rules').then((r) => r.json()).then(setRules).finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  const openNew = () => {
    setEditingRule({ ...emptyRule, conditions: [{ field: 'postcode', operator: 'starts_with', value: '' }], actions: [{ type: 'assign_day', value: 'monday' }] })
    setEditingId(null)
    setEditModal(true)
  }

  const openEdit = (rule: Rule) => {
    setEditingRule({
      name: rule.name,
      description: rule.description ?? '',
      type: rule.type,
      conditionLogic: (rule.conditionLogic === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR',
      priority: rule.priority,
      active: rule.active,
      conditions: JSON.parse(rule.conditions),
      actions: JSON.parse(rule.actions),
    })
    setEditingId(rule.id)
    setEditModal(true)
  }

  const handleSave = async () => {
    if (!editingRule) return
    setSaving(true)
    const body = { ...editingRule, priority: Number(editingRule.priority) }
    const url = editingId ? `/api/rules/${editingId}` : '/api/rules'
    const method = editingId ? 'PUT' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    setEditModal(false)
    fetchRules()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this rule?')) return
    await fetch(`/api/rules/${id}`, { method: 'DELETE' })
    fetchRules()
  }

  const handleToggle = async (rule: Rule) => {
    await fetch(`/api/rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rule,
        conditions: JSON.parse(rule.conditions),
        actions: JSON.parse(rule.actions),
        active: !rule.active,
      }),
    })
    fetchRules()
  }

  const updateCondition = (idx: number, key: keyof Condition, val: string) => {
    if (!editingRule) return
    const conds = [...editingRule.conditions]
    conds[idx] = { ...conds[idx], [key]: val }
    setEditingRule({ ...editingRule, conditions: conds })
  }

  const updateAction = (idx: number, key: keyof Action, val: string) => {
    if (!editingRule) return
    const acts = [...editingRule.actions]
    acts[idx] = { ...acts[idx], [key]: val }
    setEditingRule({ ...editingRule, actions: acts })
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Rules Engine"
        subtitle="Configure automatic scheduling and routing rules"
        actions={
          <Button size="sm" onClick={openNew}>
            <Plus size={14} /> Add Rule
          </Button>
        }
      />

      <div className="flex-1 p-6">
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Zap size={18} className="text-sky-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-sky-800">How rules work</p>
              <p className="text-sm text-sky-700 mt-1">
                Rules are applied when you import orders. Each rule has <strong>conditions</strong> (when it applies — joined by AND or OR) and <strong>actions</strong> (what it does).
                Higher priority rules run first. Use <strong>OR</strong> to match any of several postcodes or areas. Use <strong>multiple allowed days</strong> to let an order run on Tuesday or Friday.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-center text-gray-400 py-12">Loading rules...</div>
        ) : (
          <div className="space-y-3">
            {rules.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-400">
                No rules yet. Click <strong>Add Rule</strong> to create your first scheduling rule.
              </div>
            )}
            {rules.map((rule) => (
              <div key={rule.id} className={`bg-white rounded-xl border border-gray-200 p-4 ${!rule.active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{rule.name}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{rule.type}</span>
                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Priority {rule.priority}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rule.conditionLogic === 'OR' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                        {rule.conditionLogic} conditions
                      </span>
                    </div>
                    {rule.description && <p className="text-sm text-gray-500 mt-1">{rule.description}</p>}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400 font-medium">IF</span>
                      {JSON.parse(rule.conditions).map((c: Condition, i: number, arr: Condition[]) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-md">
                            {c.field} {c.operator.replace(/_/g, ' ')} &ldquo;{c.value}&rdquo;
                          </span>
                          {i < arr.length - 1 && (
                            <span className={`text-xs font-bold px-1 ${rule.conditionLogic === 'OR' ? 'text-orange-500' : 'text-blue-500'}`}>
                              {rule.conditionLogic}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400 font-medium">THEN:</span>
                      {JSON.parse(rule.actions).map((a: Action, i: number) => (
                        <span key={i} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-md">
                          {a.type.replace(/_/g, ' ')} → {a.value}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleToggle(rule)} className={`p-2 rounded transition-colors ${rule.active ? 'text-green-500 hover:text-green-600' : 'text-gray-400 hover:text-gray-500'}`}>
                      {rule.active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                    </button>
                    <button onClick={() => openEdit(rule)} className="p-2 text-gray-400 hover:text-sky-600 rounded transition-colors">
                      <Pencil size={15} />
                    </button>
                    <button onClick={() => handleDelete(rule.id)} className="p-2 text-gray-400 hover:text-red-600 rounded transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={editModal} onClose={() => setEditModal(false)} title={editingId ? 'Edit Rule' : 'New Rule'} size="xl">
        {editingRule && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Input label="Rule Name" value={editingRule.name} onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })} placeholder="e.g. DT/BH20 → Tuesday or Friday" />
              <Select label="Rule Type" value={editingRule.type} onChange={(e) => setEditingRule({ ...editingRule, type: e.target.value })} options={RULE_TYPES} />
              <Input label="Priority (higher = runs first)" type="number" value={String(editingRule.priority)} onChange={(e) => setEditingRule({ ...editingRule, priority: Number(e.target.value) })} />
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editingRule.active} onChange={(e) => setEditingRule({ ...editingRule, active: e.target.checked })} className="w-4 h-4 text-sky-600 rounded" />
                  <span className="text-sm font-medium text-gray-700">Active</span>
                </label>
              </div>
            </div>
            <TextArea label="Description (optional)" value={editingRule.description} onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })} placeholder="Explain what this rule does..." />

            {/* Conditions with AND/OR toggle */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-semibold text-gray-700">Conditions</label>
                  {/* AND / OR toggle */}
                  <div className="flex rounded-lg border border-gray-300 overflow-hidden text-xs font-medium">
                    <button
                      type="button"
                      onClick={() => setEditingRule({ ...editingRule, conditionLogic: 'AND' })}
                      className={`px-3 py-1.5 transition-colors ${editingRule.conditionLogic === 'AND' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingRule({ ...editingRule, conditionLogic: 'OR' })}
                      className={`px-3 py-1.5 transition-colors ${editingRule.conditionLogic === 'OR' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      OR
                    </button>
                  </div>
                  <span className="text-xs text-gray-400">
                    {editingRule.conditionLogic === 'AND' ? 'All conditions must match' : 'Any condition can match'}
                  </span>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditingRule({ ...editingRule, conditions: [...editingRule.conditions, { field: 'postcode', operator: 'starts_with', value: '' }] })}>
                  <Plus size={12} /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {editingRule.conditions.map((cond, i) => (
                  <div key={i} className="flex items-center gap-2">
                    {i > 0 && (
                      <span className={`text-xs font-bold w-8 text-center shrink-0 ${editingRule.conditionLogic === 'OR' ? 'text-orange-500' : 'text-blue-500'}`}>
                        {editingRule.conditionLogic}
                      </span>
                    )}
                    {i === 0 && <span className="text-xs text-gray-400 w-8 text-center shrink-0">IF</span>}
                    <div className={`flex items-center gap-2 flex-1 rounded-lg p-2.5 ${editingRule.conditionLogic === 'OR' ? 'bg-orange-50' : 'bg-blue-50'}`}>
                      <select className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" value={cond.field} onChange={(e) => updateCondition(i, 'field', e.target.value)}>
                        {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      <select className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" value={cond.operator} onChange={(e) => updateCondition(i, 'operator', e.target.value)}>
                        {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" placeholder="Value" value={cond.value} onChange={(e) => updateCondition(i, 'value', e.target.value)} />
                      {editingRule.conditions.length > 1 && (
                        <button onClick={() => setEditingRule({ ...editingRule, conditions: editingRule.conditions.filter((_, ci) => ci !== i) })} className="text-red-400 hover:text-red-600 shrink-0">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Actions (applied when conditions match)</label>
                <Button size="sm" variant="secondary" onClick={() => setEditingRule({ ...editingRule, actions: [...editingRule.actions, { type: 'assign_day', value: 'monday' }] })}>
                  <Plus size={12} /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {editingRule.actions.map((action, i) => (
                  <div key={i} className="flex items-center gap-2 bg-green-50 rounded-lg p-3">
                    <select className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" value={action.type} onChange={(e) => updateAction(i, 'type', e.target.value)}>
                      {ACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>

                    {action.type === 'assign_day' ? (
                      <select className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" value={action.value} onChange={(e) => updateAction(i, 'value', e.target.value)}>
                        {DAYS.map((d) => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                      </select>
                    ) : action.type === 'assign_days' ? (
                      <div className="flex-1 space-y-1">
                        <div className="flex flex-wrap gap-1.5">
                          {DAYS.map((d) => {
                            const selected = action.value.split(',').map((v) => v.trim()).includes(d)
                            return (
                              <button
                                key={d}
                                type="button"
                                onClick={() => {
                                  const current = action.value.split(',').map((v) => v.trim()).filter(Boolean)
                                  const next = selected ? current.filter((v) => v !== d) : [...current, d]
                                  updateAction(i, 'value', next.join(','))
                                }}
                                className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${selected ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'}`}
                              >
                                {d.charAt(0).toUpperCase() + d.slice(1)}
                              </button>
                            )
                          })}
                        </div>
                        <p className="text-xs text-gray-400">Click to toggle which days are allowed for this order</p>
                      </div>
                    ) : action.type === 'set_delivery_time' ? (
                      <select className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" value={action.value} onChange={(e) => updateAction(i, 'value', e.target.value)}>
                        <option value="am">AM</option>
                        <option value="pm">PM</option>
                      </select>
                    ) : action.type === 'block' ? (
                      <span className="flex-1 text-sm text-gray-500 px-2">Order will not be scheduled</span>
                    ) : action.type === 'set_run_weight_limit' ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          step="100"
                          className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                          placeholder="e.g. 6000"
                          value={action.value}
                          onChange={(e) => updateAction(i, 'value', e.target.value)}
                        />
                        <span className="text-sm text-gray-500 shrink-0">kg max per truck run</span>
                      </div>
                    ) : (
                      <input className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white" placeholder="Value" value={action.value} onChange={(e) => updateAction(i, 'value', e.target.value)} />
                    )}

                    {editingRule.actions.length > 1 && (
                      <button onClick={() => setEditingRule({ ...editingRule, actions: editingRule.actions.filter((_, ai) => ai !== i) })} className="text-red-400 hover:text-red-600 shrink-0">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <Button onClick={handleSave} loading={saving}>{editingId ? 'Update Rule' : 'Create Rule'}</Button>
              <Button variant="secondary" onClick={() => setEditModal(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
