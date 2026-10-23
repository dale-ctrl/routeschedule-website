/**
 * Parser for the free-text "Special Instructions" column on the BKG export.
 *
 * Sales type whatever the customer told them ("AM only", "school closes 3pm",
 * "no HGV — narrow lane", "call 30 mins before"). We pull out the parts the
 * router can act on — time windows, first/last-drop pins, day restrictions —
 * and tag the rest as flags so dispatchers and drivers see them. Anything we
 * can't interpret is still stored verbatim and shown alongside the order, and
 * dispatchers can write rules against the raw text (Rules → "Special
 * Instructions contains ...") for site-specific cases.
 *
 * Deliberately deterministic (regex, not AI) so the same text always produces
 * the same schedule and the dispatcher can see exactly why a stop moved.
 * Pure — safe to import client-side (the edit modal re-parses live).
 */

export type InstructionFlag =
  | 'first_drop'
  | 'last_drop'
  | 'call_ahead'
  | 'booking_required'
  | 'tail_lift'
  | 'small_vehicle'
  | 'hand_unload'

export const INSTRUCTION_FLAG_LABELS: Record<InstructionFlag, string> = {
  first_drop: 'First drop',
  last_drop: 'Last drop',
  call_ahead: 'Call ahead',
  booking_required: 'Booking in',
  tail_lift: 'Tail lift',
  small_vehicle: 'Small vehicle / access',
  hand_unload: 'Hand unload / 2-man',
}

export interface ParsedInstructions {
  /** Earliest delivery, minutes after midnight. */
  windowStart: number | null
  /** Latest delivery, minutes after midnight. */
  windowEnd: number | null
  /** Coarse AM/PM when that's all the text says (keeps the existing field meaningful). */
  deliveryTime: 'am' | 'pm' | null
  flags: InstructionFlag[]
  /** Weekdays the customer will accept ("Tuesdays only"). Null = no restriction. */
  allowedDays: string[] | null
  /** Weekdays the customer can't take ("closed Fridays"). */
  excludedDays: string[]
  /** Things we noticed but couldn't reconcile, e.g. "after 2pm" + "before 11am". */
  warnings: string[]
}

export const NOON_MIN = 12 * 60

const DAY_ALIASES: [RegExp, string][] = [
  [/^mon(day)?$/, 'monday'],
  [/^tue(s(day)?)?$/, 'tuesday'],
  [/^wed(s|nesday)?$/, 'wednesday'],
  [/^thu(r(s(day)?)?)?$/, 'thursday'],
  [/^fri(day)?$/, 'friday'],
  [/^sat(urday)?$/, 'saturday'],
  [/^sun(day)?$/, 'sunday'],
]
const DAY_PATTERN = '(monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)'

function normaliseDay(token: string): string | null {
  const t = token.toLowerCase()
  for (const [re, day] of DAY_ALIASES) if (re.test(t)) return day
  return null
}

// A clock time: "10", "10am", "10:30", "10.30pm", "10 a.m.", "noon", "midday".
const TIME = '(noon|midday|lunch(?:time)?|\\d{1,2}(?:[:.]\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?)'
// Guard after a TIME token: don't stop mid-number ("10.30" read as "10"), don't
// leave an am/pm suffix behind, and skip quantities ("by 2 men", "30 mins").
const NOT_A_TIME =
  '(?!\\d|[:.]\\d|\\s*[ap]\\.?m)' +
  '(?!\\s*(?:min|mins|minutes|hr|hrs|hour|hours|men|man|people|persons?|pallets?|days?|weeks?|tonnes?|kg|t\\b))'

/** Parse a TIME token to minutes after midnight. Bare 1–6 means afternoon (no 3am deliveries). */
export function parseClock(token: string): number | null {
  const t = token.toLowerCase().replace(/\s+/g, '')
  if (t === 'noon' || t === 'midday' || t.startsWith('lunch')) return NOON_MIN
  const m = t.match(/^(\d{1,2})(?:[:.](\d{2}))?(a\.?m\.?|p\.?m\.?)?$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = m[2] ? parseInt(m[2], 10) : 0
  const suffix = m[3]?.[0]
  if (h > 23 || min > 59) return null
  if (suffix === 'p' && h < 12) h += 12
  else if (suffix === 'a' && h === 12) h = 0
  else if (!suffix && h >= 1 && h <= 6) h += 12
  return h * 60 + min
}

/** "09:30" — shared by the UI for windows and ETAs. */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = Math.round(minutes % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "09:30" → 570. Accepts the value of an <input type="time">. */
export function clockToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const m = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

export function parseSpecialInstructions(raw: string | null | undefined): ParsedInstructions {
  const result: ParsedInstructions = {
    windowStart: null,
    windowEnd: null,
    deliveryTime: null,
    flags: [],
    allowedDays: null,
    excludedDays: [],
    warnings: [],
  }
  const text = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!text) return result

  const starts: number[] = []
  const ends: number[] = []

  // Ranges: "between 9 and 11", "9am-11am", "09:00 - 12:00", "open 8 till 3".
  // A bare "2-3" is too ambiguous (pallets? days?) so we need a keyword,
  // a colon or an am/pm marker before treating it as a window.
  const rangeRe = new RegExp(
    `(between|from|open|opens|window|deliver(?:y|ies)?|slot)?\\s*\\b${TIME}${NOT_A_TIME}\\s*(?:-|–|to|and|until|till|til)\\s*${TIME}${NOT_A_TIME}`,
    'g'
  )
  for (const m of text.matchAll(rangeRe)) {
    const [, keyword, a, b] = m
    const explicit = keyword || /[:.]|[ap]\.?m/.test(a + b) || /noon|midday/.test(a + b)
    if (!explicit) continue
    let start = parseClock(a)
    const end = parseClock(b)
    if (start === null || end === null) continue
    // "9-11am": the suffix on the end applies to the start too.
    if (!/[ap]\.?m/.test(a) && /p\.?m/.test(b) && start + 12 * 60 <= end) start += 12 * 60
    if (start < end) { starts.push(start); ends.push(end) }
  }

  const endRe = new RegExp(
    `\\b(?:(?<!not )before|by|no later than|not later than|latest|until|till|closes?(?: at)?)\\s+${TIME}${NOT_A_TIME}`,
    'g'
  )
  for (const m of text.matchAll(endRe)) {
    const t = parseClock(m[1])
    if (t !== null) ends.push(t)
  }

  const startRe = new RegExp(
    `\\b(?:after|not before|no earlier than|earliest|opens?(?: at)?|from)\\s+${TIME}${NOT_A_TIME}(?!\\s*(?:-|–|to|and|until|till|til)\\s*\\d)`,
    'g'
  )
  for (const m of text.matchAll(startRe)) {
    const t = parseClock(m[1])
    if (t !== null) starts.push(t)
  }

  // Coarse AM/PM — only when it isn't the suffix of a clock time ("10am").
  const notAm = /\b(no|not)\s+(am|a\.m\.?|morning)s?\b/.test(text)
  const notPm = /\b(no|not)\s+(pm|p\.m\.?|afternoon)s?\b/.test(text)
  const saysAm = /(?<![\d.:]\s?)\b(am|a\.m\.?|morning)\b/.test(text) && !notAm
  const saysPm = /(?<![\d.:]\s?)\b(pm|p\.m\.?|afternoon)\b/.test(text) && !notPm
  if ((saysAm && !saysPm) || notPm) {
    ends.push(NOON_MIN)
    result.deliveryTime = 'am'
  } else if ((saysPm && !saysAm) || notAm) {
    starts.push(NOON_MIN)
    result.deliveryTime = 'pm'
  }

  if (starts.length > 0) result.windowStart = Math.max(...starts)
  if (ends.length > 0) result.windowEnd = Math.min(...ends)
  if (result.windowStart !== null && result.windowEnd !== null && result.windowStart >= result.windowEnd) {
    result.warnings.push(
      `Conflicting times (after ${formatClock(result.windowStart)} but before ${formatClock(result.windowEnd)}) — please set the window manually`
    )
    result.windowStart = null
    result.windowEnd = null
    result.deliveryTime = null
  }
  if (!result.deliveryTime) {
    if (result.windowEnd !== null && result.windowEnd <= NOON_MIN) result.deliveryTime = 'am'
    else if (result.windowStart !== null && result.windowStart >= NOON_MIN) result.deliveryTime = 'pm'
  }

  const flag = (f: InstructionFlag, re: RegExp) => {
    if (re.test(text) && !result.flags.includes(f)) result.flags.push(f)
  }
  flag('first_drop', /\b(first|1st) (drop|delivery|stop|thing|on the (route|run))\b|\bfirst drop\b/)
  flag('last_drop', /\b(last|final) (drop|delivery|stop)\b/)
  flag('call_ahead', /\b(call|phone|ring|tel(ephone)?)\b[^.;]{0,30}\b(ahead|before|prior|advance|beforehand|en route)\b|\bcall ahead\b/)
  flag('booking_required', /\bbook(ing)?[- ]?in\b|\bbooking (required|needed|ref|reference)\b|\b(appointment|pre[- ]?book(ed)?|must be booked|slot required)\b/)
  flag('tail_lift', /\btail[- ]?lift\b/)
  flag(
    'small_vehicle',
    /\b(no|not suitable for|unsuitable for|can'?t take)\s+(hgvs?|lorry|lorries|artics?|large vehicles?|big trucks?|trucks?|18\s*t(onne)?s?|26\s*t(onne)?s?)\b|\bsmall (vehicle|van|truck)\b|\bvan only\b|\b(narrow|single[- ]track|tight) (lane|road|access|entrance|gate)\b|\blow bridge\b|\b(weight|width|height) restrict/
  )
  flag('hand_unload', /\bhand ?ball(ed)?\b|\bhand unload\b|\bno (forklift|fork lift|pump truck|pallet truck)\b|\b(2|two)[- ](man|men|people|person)\b/)
  if (result.flags.includes('first_drop') && result.flags.includes('last_drop')) {
    result.warnings.push('Says both first and last drop — please check')
  }

  // Day restrictions. Lists are common ("not Monday or Friday", "Tues/Thurs only").
  const DAY_LIST = `(${DAY_PATTERN}s?(?:\\s*(?:,|/|&|\\bor\\b|\\band\\b)\\s*${DAY_PATTERN}s?)*)`
  const daysIn = (list: string) =>
    list.split(/\s*(?:,|\/|&|\bor\b|\band\b)\s*/).map((t) => normaliseDay(t.replace(/s$/, ''))).filter((d): d is string => d !== null)
  for (const m of text.matchAll(new RegExp(`\\b(?:not|no|closed|never)\\s+(?:on\\s+)?${DAY_LIST}\\b`, 'g'))) {
    for (const d of daysIn(m[1])) if (!result.excludedDays.includes(d)) result.excludedDays.push(d)
  }
  const allowed = new Set<string>()
  for (const re of [`\\b${DAY_LIST}\\s+only\\b`, `\\bonly\\s+(?:on\\s+)?${DAY_LIST}\\b`]) {
    for (const m of text.matchAll(new RegExp(re, 'g'))) {
      for (const d of daysIn(m[1])) allowed.add(d)
    }
  }
  if (allowed.size > 0) result.allowedDays = [...allowed].filter((d) => !result.excludedDays.includes(d))

  return result
}

/** Comma-separated flag codes as stored on Order.instructionFlags → typed list. */
export function parseFlags(stored: string | null | undefined): InstructionFlag[] {
  if (!stored) return []
  return stored
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is InstructionFlag => s in INSTRUCTION_FLAG_LABELS)
}

/**
 * The window the router should respect for an order. Explicit start/end (from
 * special instructions or set by hand) win; otherwise the coarse AM/PM field
 * maps to before/after noon. Returns nulls for "any time".
 */
export function effectiveWindow(o: {
  deliveryTime?: string | null
  windowStart?: number | null
  windowEnd?: number | null
}): { start: number | null; end: number | null } {
  const start = o.windowStart ?? (o.deliveryTime === 'pm' ? NOON_MIN : null)
  const end = o.windowEnd ?? (o.deliveryTime === 'am' ? NOON_MIN : null)
  return { start, end }
}

/** Short human label for a window: "AM", "PM", "Before 10:00", "After 13:30", "09:00–11:00". */
export function windowLabel(o: {
  deliveryTime?: string | null
  windowStart?: number | null
  windowEnd?: number | null
}): string | null {
  const { start, end } = effectiveWindow(o)
  if (start === null && end === null) return null
  if (start !== null && end !== null) return `${formatClock(start)}–${formatClock(end)}`
  if (end !== null) return end === NOON_MIN ? 'AM' : `Before ${formatClock(end)}`
  return start === NOON_MIN ? 'PM' : `After ${formatClock(start!)}`
}
