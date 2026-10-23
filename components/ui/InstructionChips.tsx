import { Badge } from '@/components/ui/Badge'
import { INSTRUCTION_FLAG_LABELS, parseFlags, windowLabel } from '@/lib/special-instructions'

interface InstructionChipsProps {
  order: {
    deliveryTime?: string | null
    windowStart?: number | null
    windowEnd?: number | null
    instructionFlags?: string | null
  }
  className?: string
}

/**
 * Compact badges for what the router took from an order's special
 * instructions: the delivery window (blue — it moves stops) and handling
 * flags (grey — for the dispatcher/driver). Renders nothing when empty.
 */
export function InstructionChips({ order, className }: InstructionChipsProps) {
  const window = windowLabel(order)
  const flags = parseFlags(order.instructionFlags)
  if (!window && flags.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-1 ${className ?? ''}`}>
      {window && <Badge variant="info" className="px-2">{window}</Badge>}
      {flags.map((f) => (
        <Badge key={f} variant={f === 'first_drop' || f === 'last_drop' ? 'info' : 'default'} className="px-2">
          {INSTRUCTION_FLAG_LABELS[f]}
        </Badge>
      ))}
    </div>
  )
}
