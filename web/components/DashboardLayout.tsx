'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}
interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Screening',
    items: [
      { label: 'Parties', href: '/dashboard/parties' },
      { label: 'Matches', href: '/dashboard/matches' },
      { label: 'Screenings', href: '/dashboard/screenings' },
      { label: 'Re-screen', href: '/dashboard/rescreen' },
    ],
  },
  {
    title: 'Lists',
    items: [
      { label: 'Lists', href: '/dashboard/lists' },
      { label: 'Allowlist', href: '/dashboard/allowlist' },
    ],
  },
  {
    title: 'Orders',
    items: [
      { label: 'Orders', href: '/dashboard/orders' },
      { label: 'Embargoes & End Uses', href: '/dashboard/embargoes' },
    ],
  },
  {
    title: 'Record',
    items: [
      { label: 'Ledger', href: '/dashboard/ledger' },
      { label: 'Exports', href: '/dashboard/exports' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Policy', href: '/dashboard/policy' },
      { label: 'Members', href: '/dashboard/members' },
      { label: 'Segments', href: '/dashboard/segments' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [userLabel, setUserLabel] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      const user = (s as any)?.data?.user ?? (s as any)?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      setUserLabel(user.name || user.email || 'Account')
      setChecking(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <span className="text-zinc-500 text-sm">Verifying session...</span>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="px-2 flex items-center gap-2">
        <span className="inline-block h-6 w-6 rounded bg-amber-500" />
        <span className="text-sm font-bold tracking-tight text-zinc-100">
          ExportScreening<span className="text-amber-400">Ledger</span>
        </span>
      </Link>
      <div className="flex flex-col gap-5">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
              {section.title}
            </div>
            <div className="flex flex-col">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-2 py-1.5 text-sm transition-colors ${
                      active
                        ? 'bg-amber-500/10 font-medium text-amber-400'
                        : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-zinc-800 bg-zinc-900/40 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawerOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-zinc-800 bg-zinc-900">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-60">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <button
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-zinc-300">Workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-400 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
