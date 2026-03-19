import { prisma } from '@/lib/prisma'

export async function GET() {
  const rules = await prisma.rule.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }] })
  return Response.json(rules)
}

export async function POST(request: Request) {
  const body = await request.json()
  const rule = await prisma.rule.create({
    data: {
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      conditionLogic: body.conditionLogic === 'OR' ? 'OR' : 'AND',
      conditions: JSON.stringify(body.conditions ?? []),
      actions: JSON.stringify(body.actions ?? []),
      priority: body.priority ?? 0,
      active: body.active ?? true,
    },
  })
  return Response.json(rule, { status: 201 })
}
