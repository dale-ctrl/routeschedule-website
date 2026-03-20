'use client'

import { useEffect, useState, useCallback } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, TextArea } from '@/components/ui/Input'
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Zap, Sparkles, Wand2 } from 'lucide-react'

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
  { value: 'depot', label: 'Depot' },
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
  { value: 'set_min_truck_load', label: 'Consolidate trucks — minimum load % before using a second truck' },
  { value: 'assign_truck_type', label: 'Require specific truck type' },
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
  { value: 'truck_consolidation', label: 'Truck Consolidation' },
  { value: 'ai_natural', label: 'AI Natural Language Rule' },
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

interface AISuggestResult {
  structured: boolean
  name: string
  description?: string
  notes?: string
  type?: string
  conditionLogic?: string
  conditions?: Condition[]
  actions?: Action[]
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([])
  const [truckTypes, setTruckTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState(false)
  const [editingRule, setEditingRule] = useState<typeof emptyRule | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // AI rule modal state
  const [aiModal, setAiModal] = useState(false)
  const [aiDescription, setAiDescription] = useState('')
  const [aiName, setAiName] = useState('')
  const [aiConverting, setAiConverting] = useState(false)
  const [aiResult, setAiResult] = useState<AISuggestResult | null>(null)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiEditingId, setAiEditingId] = useState<string | null>(null)

  const fetchRules = useCallback(() => {
    setLoading(true)
    fetch('/api/rules').then((r) => r.json()).then(setRules).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchRules()
    fetch('/api/trucks')
      .then((r) => r.json())
      .then((trucks: { type: string }[]) => {
        const unique = [...new Set(trucks.map((t) => t.type).filter(Boolean))]
        setTruckTypes(unique)
      })
  }, [fetchRules])

  const openNew = () => {
    setEditingRule({ ...emptyRule, conditions: [{ field: 'postcode', operator: 'starts_with', value: '' }], actions: [{ type: 'assign_day', value: 'monday' }] })
    setEditingId(null)
    setEditModal(true)
  }

  const openNewAI = () => {
    setAiDescription('')
    setAiName('')
    setAiResult(null)
    setAiEditingId(null)
    setAiModal(true)
  }

  const openEdit = (rule: Rule) => {
    if (rule.type === 'ai_natural') {
      setAiDescription(rule.description ?? '')
      setAiName(rule.name)
      setAiResult(null)
      setAiEditingId(rule.id)
      setAiModal(true)
      return
    }
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

  const handleAIConvert = async () => {
    if (!aiDescription.trim()) return
    setAiConverting(true)
    setAiResult(null)
    try {
      const res = await fetch('/api/rules/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription }),
      })
      const data = await res.json()
      if (res.ok) {
        setAiResult(data)
        if (!aiName && data.name) setAiName(data.name)
      } else {
        setAiResult({ structured: false, name: aiName || 'Custom Rule', notes: data.error })
      }
    } finally {
      setAiConverting(false)
    }
  }

  const handleAISaveAsStructured = async () => {
    if (!aiResult?.structured) return
    setAiSaving(true)
    const body = {
      name: aiName || aiResult.name || 'AI Rule',
      description: aiResult.description ?? aiDescription,
      type: aiResult.type || 'general',
      conditionLogic: aiResult.conditionLogic || 'AND',
      conditions: aiResult.conditions ?? [],
      actions: aiResult.actions ?? [],
      priority: 0,
      active: true,
    }
    const url = aiEditingId ? `/api/rules/${aiEditingId}` : '/api/rules'
    const method = aiEditingId ? 'PUT' : 'POST'
    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setAiSaving(false)
    closeAIModal()
    fetchRules()
  }

  const closeAIModal = () => {
    setAiModal(false)
    setAiDescription('')
    setAiName('')
    setAiResult(null)
    setAiEditingId(null)
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Rules Engine"
        subtitle="Configure automatic scheduling and routing rules"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={openNewAI}>
              <Sparkles size={14} /> Add AI Rule
            </Button>
            <Button size="sm" onClick={openNew}>
              <Plus size={14} /> Add Rule
            </Button>
          </div>
        }
      />

      <div className="flex-1 p-6">
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <Zap size={18} className="text-sky-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-sky-800">How rules work</p>
              <p className="text-sm text-sky-700 mt-1">
                Rules are applied when you import orders. Each rule has <strong>conditions</strong> (when it applies) and <strong>actions</strong> (what it does).
                Use <strong>Add AI Rule</strong> to describe a rule in plain English — the system will automatically convert it or remember it as an AI rule applied at import.
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
                No rules yet. Click <strong>Add AI Rule</strong> to describe a rule in plain English, or <strong>Add Rule</strong> to build one manually.
              </div>
            )}
            {rules.map((rule) => (
              <div key={rule.id} className={`bg-white rounded-xl border p-4 ${!rule.active ? 'opacity-50' : ''} ${rule.type === 'ai_natural' ? 'border-purple-200' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900">{rule.name}</span>
                      {rule.type === 'ai_natural' ? (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Sparkles size={10} /> AI Rule
                        </span>
                      ) : (
                        <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{rule.type}</span>
                      )}
                      <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Priority {rule.priority}</span>
                      {rule.type !== 'ai_natural' && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rule.conditionLogic === 'OR' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}>
                          {rule.conditionLogic} conditions
                        </span>
                      )}
                    </div>

                    {rule.type === 'ai_natural' ? (
                      <p className="text-sm text-gray-700 mt-2 bg-purple-50 rounded-lg px-3 py-2 border border-purple-100">
                        {rule.description ?? '(no description)'}
                      </p>
                    ) : (
                      <>
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
                      </>
                    )}
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

      {/* Standard rule edit modal */}
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
                    ) : action.type === 'set_min_truck_load' ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="5"
                          className="w-24 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                          placeholder="e.g. 70"
                          value={action.value}
                          onChange={(e) => updateAction(i, 'value', e.target.value)}
                        />
                        <span className="text-sm text-gray-500">% — only send a second truck if the first would be at least this full</span>
                      </div>
                    ) : action.type === 'assign_truck_type' ? (
                      <select
                        className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white"
                        value={action.value}
                        onChange={(e) => updateAction(i, 'value', e.target.value)}
                      >
                        <option value="">— select truck type —</option>
                        {truckTypes.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
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

      {/* AI Rule modal */}
      <Modal open={aiModal} onClose={closeAIModal} title={aiEditingId ? 'Edit AI Rule' : 'Add Rule with AI'} size="lg">
        <div className="space-y-4">
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-sm text-purple-800">
              Describe what you want the rule to do in plain English. The AI will try to convert it to a structured rule automatically.
              If it&apos;s too complex, it&apos;ll be saved as an AI rule and applied intelligently at import time.
            </p>
          </div>

          <Input
            label="Rule name (optional — AI will suggest one)"
            value={aiName}
            onChange={(e) => setAiName(e.target.value)}
            placeholder="e.g. Cornwall AM deliveries"
          />

          <TextArea
            label="Describe the rule in plain English"
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
            placeholder="e.g. All orders going to TR postcodes should be delivered on Tuesdays and Thursdays, in the morning. They should have priority 5."
            rows={4}
          />

          <Button
            onClick={handleAIConvert}
            loading={aiConverting}
            disabled={!aiDescription.trim()}
            variant="secondary"
          >
            <Wand2 size={14} /> Convert with AI
          </Button>

          {/* AI conversion result */}
          {aiResult && (
            <div className={`rounded-lg border p-4 space-y-3 ${aiResult.structured ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
              {aiResult.structured ? (
                <>
                  <p className="text-sm font-medium text-green-800">Rule converted — will run locally with no AI cost.</p>
                  {aiResult.description && (
                    <p className="text-sm text-green-700">{aiResult.description}</p>
                  )}
                  {aiResult.conditions && aiResult.conditions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs text-gray-500 font-medium">IF</span>
                      {aiResult.conditions.map((c, i) => (
                        <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                          {c.field} {c.operator.replace(/_/g, ' ')} &ldquo;{c.value}&rdquo;
                        </span>
                      ))}
                    </div>
                  )}
                  {aiResult.actions && aiResult.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-xs text-gray-500 font-medium">THEN</span>
                      {aiResult.actions.map((a, i) => (
                        <span key={i} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                          {a.type.replace(/_/g, ' ')} → {a.value}
                        </span>
                      ))}
                    </div>
                  )}
                  {aiResult.notes && (
                    <p className="text-xs text-green-600 italic">{aiResult.notes}</p>
                  )}
                  <Button onClick={handleAISaveAsStructured} loading={aiSaving}>
                    Save Rule
                  </Button>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-800">
                    Couldn&apos;t fully structure this rule automatically.
                  </p>
                  {aiResult.notes && (
                    <p className="text-sm text-amber-700">{aiResult.notes}</p>
                  )}
                  <p className="text-sm text-amber-700">
                    Try rephrasing it more specifically — e.g. specify exact postcodes, days, or customer names. You can also add it manually using <strong>Add Rule</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <Button variant="secondary" onClick={closeAIModal}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
