'use client'

import { useEffect, useId, useState } from 'react'
import { useTheme } from 'next-themes'

type MermaidProps = {
  chart: string
}

export default function Mermaid({ chart }: MermaidProps) {
  const rawId = useId()
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { resolvedTheme } = useTheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function renderChart() {
      setError('')
      setSvg('')

      try {
        const mermaid = (await import('mermaid')).default

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
          fontFamily: 'var(--font-sans), system-ui, sans-serif',
        })

        const renderId = `${id}-${Date.now().toString(36)}`
        const result = await mermaid.render(renderId, chart.trim())
        if (!cancelled) setSvg(result.svg)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Mermaid render failed')
      }
    }

    renderChart()

    return () => {
      cancelled = true
    }
  }, [chart, id, resolvedTheme])

  if (error) {
    return (
      <pre className="overflow-x-auto rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
        <code>{chart}</code>
      </pre>
    )
  }

  return (
    <div
      className="my-8 overflow-x-auto rounded border border-divider bg-white p-4 dark:border-dark-divider dark:bg-dark-elevated"
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      suppressHydrationWarning
    />
  )
}
