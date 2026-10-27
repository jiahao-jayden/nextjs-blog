'use client'

import { usePathname } from 'next/navigation'
import { ThemeProvider } from 'next-themes'
import siteMetadata from '@/data/siteMetadata'

export function ThemeProviders({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme={siteMetadata.theme}
      enableSystem
      forcedTheme={pathname === '/' ? 'light' : undefined}
    >
      {children}
    </ThemeProvider>
  )
}
