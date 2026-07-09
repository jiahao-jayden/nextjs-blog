import TOCInline from 'pliny/ui/TOCInline'
import PlinyPre from 'pliny/ui/Pre'
import BlogNewsletterForm from 'pliny/ui/BlogNewsletterForm'
import type { MDXComponents } from 'mdx/types'
import { isValidElement, type ReactNode } from 'react'
import Image from './Image'
import CustomLink from './Link'
import Mermaid from './Mermaid'
import TableWrapper from './TableWrapper'

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return ''
}

function mermaidSource(children: ReactNode) {
  const child = Array.isArray(children) ? children[0] : children

  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null

  const className = child.props.className || ''
  if (!className.split(/\s+/).includes('language-mermaid')) return null

  return nodeText(child.props.children)
}

function Pre({ children }: { children?: ReactNode }) {
  const chart = mermaidSource(children)

  if (chart !== null) return <Mermaid chart={chart} />

  return <PlinyPre>{children}</PlinyPre>
}

export const components: MDXComponents = {
  Image,
  TOCInline,
  a: CustomLink,
  pre: Pre,
  table: TableWrapper,
  BlogNewsletterForm,
}
