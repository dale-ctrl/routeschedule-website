import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { password } = await request.json() as { password: string }

  const AUTH_PASSWORD = process.env.AUTH_PASSWORD
  const AUTH_SECRET = process.env.AUTH_SECRET

  if (!AUTH_PASSWORD || !AUTH_SECRET) {
    return Response.json({ error: 'Auth not configured on server.' }, { status: 500 })
  }

  if (password !== AUTH_PASSWORD) {
    return Response.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  const cookieStore = await cookies()
  cookieStore.set('session', AUTH_SECRET, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: '/',
  })

  return Response.json({ ok: true })
}
