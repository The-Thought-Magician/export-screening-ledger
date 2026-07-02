import type { Metadata } from 'next'
import { Work_Sans } from 'next/font/google'
import './globals.css'

const workSans = Work_Sans({
  subsets: ['latin'],
  variable: '--font-work-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ExportScreeningLedger',
  description: 'Continuous restricted-party screening, structured adjudication, and an immutable decision-of-record for export-compliance teams.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={workSans.variable}>
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased font-sans">{children}</body>
    </html>
  )
}
