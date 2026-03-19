import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rule = await prisma.rule.findUnique({ where: { id } })
  if (!rule) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(rule)
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const rule = await prisma.rule.update({
    where: { id },
    data: {
      name: body.name,
      description: body.description,
      type: body.type,
      conditionLogic: body.conditionLogic === 'OR' ? 'OR' : 'AND',
      conditions: JSON.stringify(body.conditions ?? []),
      actions: JSON.stringify(body.actions ?? []),
      priority: body.priority ?? 0,
      active: body.active ?? true,
    },
  })
  return Response.json(rule)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.rule.delete({ where: { id } })
  return Response.json({ deleted: true })
}
