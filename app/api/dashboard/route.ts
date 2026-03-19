import { prisma } from '@/lib/prisma'

export async function GET() {
  const [totalOrders, pendingOrders, scheduledOrders, totalRoutes, activeTrucks, totalRules] =
    await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: 'pending' } }),
      prisma.order.count({ where: { status: 'scheduled' } }),
      prisma.route.count(),
      prisma.truck.count({ where: { active: true } }),
      prisma.rule.count({ where: { active: true } }),
    ])

  const recentRoutes = await prisma.route.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      truck: { select: { name: true } },
      stops: { include: { order: { select: { customer: true, postcode: true } } } },
    },
  })

  const weightByDay = await prisma.order.groupBy({
    by: ['scheduledDay'],
    _sum: { weight: true },
    _count: true,
    where: { status: { in: ['scheduled', 'delivered'] } },
  })

  return Response.json({
    stats: {
      totalOrders,
      pendingOrders,
      scheduledOrders,
      totalRoutes,
      activeTrucks,
      totalRules,
    },
    recentRoutes,
    weightByDay,
  })
}
