'use client'

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type WheelEvent,
} from 'react'
import { useTheme } from 'next-themes'

type MermaidProps = {
  chart: string
}

type Point = {
  x: number
  y: number
}

type PanState = Point & {
  pointerId: number
  origin: Point
}

const MIN_ZOOM = 0.75
const MAX_ZOOM = 4
const ZOOM_STEP = 0.25

export default function Mermaid({ chart }: MermaidProps) {
  const rawId = useId()
  const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const { resolvedTheme } = useTheme()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panRef = useRef<PanState | null>(null)

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

  useEffect(() => {
    if (!isPreviewOpen) return

    const dialog = dialogRef.current
    if (!dialog || dialog.open) return

    dialog.showModal()

    return () => {
      if (dialog.open) dialog.close()
    }
  }, [isPreviewOpen])

  function openPreview() {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
    setIsDragging(false)
    panRef.current = null
    setIsPreviewOpen(true)
  }

  function closePreview() {
    const dialog = dialogRef.current
    if (dialog?.open) {
      dialog.close()
    } else {
      setIsPreviewOpen(false)
    }
  }

  function updateZoom(nextZoom: number) {
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
    setZoom(clampedZoom)
    if (clampedZoom <= 1) setOffset({ x: 0, y: 0 })
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault()
    updateZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return

    event.currentTarget.setPointerCapture(event.pointerId)
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: offset,
    }
    setIsDragging(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return

    setOffset({
      x: pan.origin.x + event.clientX - pan.x,
      y: pan.origin.y + event.clientY - pan.y,
    })
  }

  function endPointerDrag(event: PointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    panRef.current = null
    setIsDragging(false)
  }

  function handleDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) closePreview()
  }

  if (error) {
    return (
      <pre className="overflow-x-auto rounded border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-100">
        <code>{chart}</code>
      </pre>
    )
  }

  return (
    <>
      <div className="my-8 overflow-x-auto rounded border border-divider bg-white dark:border-dark-divider dark:bg-dark-elevated">
        <button
          type="button"
          className="group relative block w-full cursor-zoom-in appearance-none border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
          aria-label="Open Mermaid diagram in full-screen preview"
          onClick={openPreview}
        >
          <div
            className="p-4"
            dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
            suppressHydrationWarning
          />
          <span className="pointer-events-none absolute top-3 right-3 inline-flex h-9 w-9 items-center justify-center rounded-full border border-divider bg-white/90 text-muted opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 dark:border-dark-divider dark:bg-dark-elevated/90 dark:text-dark-muted">
            <ZoomIcon />
          </span>
        </button>
      </div>

      {isPreviewOpen && svg && (
        <dialog
          ref={dialogRef}
          className="mermaid-preview-dialog"
          aria-label="Mermaid diagram preview"
          onCancel={(event) => {
            event.preventDefault()
            closePreview()
          }}
          onClose={() => setIsPreviewOpen(false)}
          onClick={handleDialogClick}
        >
          <div className="flex h-full w-full flex-col bg-vellum dark:bg-dark-surface">
            <div className="flex items-center justify-between border-b border-divider px-4 py-3 dark:border-dark-divider">
              <span className="text-book dark:text-dark-muted text-sm">Mermaid diagram</span>
              <div className="flex items-center gap-1" role="toolbar" aria-label="Diagram controls">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-book transition-colors hover:bg-gray-100 hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 active:bg-gray-200 dark:text-dark-muted dark:hover:bg-dark-elevated dark:hover:text-dark-text dark:active:bg-dark-divider"
                  aria-label="Zoom out"
                  title="Zoom out"
                  onClick={() => updateZoom(zoom - ZOOM_STEP)}
                >
                  <MinusIcon />
                </button>
                <span className="text-muted dark:text-dark-muted w-12 text-center text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-book transition-colors hover:bg-gray-100 hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 active:bg-gray-200 dark:text-dark-muted dark:hover:bg-dark-elevated dark:hover:text-dark-text dark:active:bg-dark-divider"
                  aria-label="Zoom in"
                  title="Zoom in"
                  onClick={() => updateZoom(zoom + ZOOM_STEP)}
                >
                  <PlusIcon />
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full text-book transition-colors hover:bg-gray-100 hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 active:bg-gray-200 dark:text-dark-muted dark:hover:bg-dark-elevated dark:hover:text-dark-text dark:active:bg-dark-divider"
                  aria-label="Reset zoom"
                  title="Reset zoom"
                  onClick={() => {
                    setZoom(1)
                    setOffset({ x: 0, y: 0 })
                  }}
                >
                  <ResetIcon />
                </button>
                <button
                  type="button"
                  className="ml-1 inline-flex h-10 w-10 items-center justify-center rounded-full text-book transition-colors hover:bg-gray-100 hover:text-charcoal focus-visible:outline-2 focus-visible:outline-offset-2 active:bg-gray-200 dark:text-dark-muted dark:hover:bg-dark-elevated dark:hover:text-dark-text dark:active:bg-dark-divider"
                  aria-label="Close preview"
                  title="Close preview"
                  onClick={closePreview}
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            <div
              className="mermaid-preview-stage"
              style={{ touchAction: zoom > 1 ? 'none' : 'pan-y' }}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={endPointerDrag}
              onPointerCancel={endPointerDrag}
            >
              <div
                className="mermaid-preview-canvas"
                style={
                  {
                    transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                    cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
                  } as CSSProperties
                }
              >
                <div className="mermaid-preview-svg" dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
            </div>
          </div>
        </dialog>
      )}
    </>
  )
}

function ZoomIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="10.75" cy="10.75" r="5.75" />
      <path d="m15 15 4.5 4.5M10.75 8v5.5M8 10.75h5.5" strokeLinecap="round" />
    </svg>
  )
}

function MinusIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M5 9a7 7 0 1 1 1.4 7.8" strokeLinecap="round" />
      <path d="M5 4.5V9h4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  )
}
