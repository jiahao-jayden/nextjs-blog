import { ReactNode } from 'react'
import { formatDate } from 'pliny/utils/formatDate'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog } from 'contentlayer/generated'
import Comments from '@/components/Comments'
import Link from '@/components/Link'
import PageTitle from '@/components/PageTitle'
import SectionContainer from '@/components/SectionContainer'
import siteMetadata from '@/data/siteMetadata'
import ScrollTopAndComment from '@/components/ScrollTopAndComment'

interface LayoutProps {
  content: CoreContent<Blog>
  children: ReactNode
  next?: { path: string; title: string }
  prev?: { path: string; title: string }
}

export default function PostLayout({ content, next, prev, children }: LayoutProps) {
  const { path, slug, date, title } = content

  return (
    <SectionContainer>
      <ScrollTopAndComment />
      <article>
        <header className="border-divider dark:border-dark-divider border-b pt-10 pb-8">
          <div className="animate-fade-up text-muted dark:text-dark-muted text-[13px]">
            <time dateTime={date}>{formatDate(date, siteMetadata.locale)}</time>
          </div>
          <div className="animate-fade-up animate-delay-1 mt-3">
            <PageTitle>{title}</PageTitle>
          </div>
        </header>
        <div className="animate-fade-up animate-delay-2 prose dark:prose-invert max-w-none pt-8 pb-8 [&>*]:max-w-[65ch]">
          {children}
        </div>
        {siteMetadata.comments && (
          <div className="border-divider dark:border-dark-divider border-t pt-8 pb-8" id="comment">
            <Comments slug={slug} />
          </div>
        )}
        <footer className="border-divider dark:border-dark-divider border-t pt-6 pb-8">
          <div className="flex items-center justify-between text-sm">
            {prev && prev.path ? (
              <Link
                href={`/${prev.path}`}
                className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text transition-colors"
                aria-label={`Previous post: ${prev.title}`}
              >
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && next.path ? (
              <Link
                href={`/${next.path}`}
                className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text transition-colors"
                aria-label={`Next post: ${next.title}`}
              >
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </div>
        </footer>
      </article>
    </SectionContainer>
  )
}
