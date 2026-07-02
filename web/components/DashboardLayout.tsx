'use client'
import { useEffect, useRef, useState } from 'react'
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

function sectionActive(pathname: string, section: NavSection): boolean {
  return section.items.some((item) => isActive(pathname, item.href))
}

function NavDropdown({ section, pathname }: { section: NavSection; pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = sectionActive(pathname, section)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (section.items.length === 1) {
    const item = section.items[0]
    return (
      <Link
        href={item.href}
        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive(pathname, item.href)
            ? 'bg-lime-500/10 text-lime-400'
            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
        }`}
      >
        {section.title}
      </Link>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          active ? 'bg-lime-500/10 text-lime-400' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
        }`}
      >
        {section.title}
        <span className="text-[10px]">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 min-w-48 rounded-lg border border-zinc-800 bg-zinc-900 p-1.5 shadow-xl">
          {section.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive(pathname, item.href)
                  ? 'bg-lime-500/10 font-medium text-lime-400'
                  : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
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
    setMobileOpen(false)
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

  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-30 w-full border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
              <span className="inline-block h-6 w-6 rounded bg-lime-500" />
              <span className="text-sm font-bold tracking-tight text-zinc-100">
                ExportScreening<span className="text-lime-400">Ledger</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-1 lg:flex">
              {NAV.map((section) => (
                <NavDropdown key={section.title} section={section} pathname={pathname} />
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-400 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              Sign out
            </button>
            <button
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
              onClick={() => setMobileOpen((v) => !v)}
              aria-label="Toggle menu"
              aria-expanded={mobileOpen}
            >
              ☰
            </button>
          </div>
        </div>

        {/* Mobile nav */}
        {mobileOpen && (
          <nav className="border-t border-zinc-800 px-4 py-3 lg:hidden">
            <div className="flex flex-col gap-4">
              {NAV.map((section) => (
                <div key={section.title}>
                  <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    {section.title}
                  </div>
                  <div className="flex flex-col">
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`rounded-lg px-2 py-1.5 text-sm transition-colors ${
                          isActive(pathname, item.href)
                            ? 'bg-lime-500/10 font-medium text-lime-400'
                            : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                        }`}
                      >
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </nav>
        )}
      </header>

      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  )
}
