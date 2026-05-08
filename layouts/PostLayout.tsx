import { ReactNode } from 'react'
import { CoreContent } from 'pliny/utils/contentlayer'
import type { Blog, Authors } from 'contentlayer/generated'
import Comments from '@/components/Comments'
import Link from '@/components/Link'
import PageTitle from '@/components/PageTitle'
import SectionContainer from '@/components/SectionContainer'
import Image from '@/components/Image'
import Tag from '@/components/Tag'
import siteMetadata from '@/data/siteMetadata'
import ScrollTopAndComment from '@/components/ScrollTopAndComment'

const postDateTemplate: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
}

interface LayoutProps {
  content: CoreContent<Blog>
  authorDetails: CoreContent<Authors>[]
  next?: { path: string; title: string }
  prev?: { path: string; title: string }
  children: ReactNode
}

export default function PostLayout({ content, authorDetails, next, prev, children }: LayoutProps) {
  const { filePath, path, slug, date, title, tags } = content
  const basePath = path.split('/')[0]

  return (
    <SectionContainer>
      <ScrollTopAndComment />
      <article>
        <header className="pt-10 pb-8">
          <div className="animate-fade-up text-muted dark:text-dark-muted flex items-center gap-2 text-[13px]">
            <time dateTime={date}>
              {new Date(date).toLocaleDateString(siteMetadata.locale, postDateTemplate)}
            </time>
            {tags && tags.length > 0 && (
              <>
                <span>·</span>
                <div className="flex items-center gap-1">
                  {tags.map((tag, i) => (
                    <span key={tag} className="flex items-center gap-1">
                      {i > 0 && <span>·</span>}
                      <Tag text={tag} />
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <h1 className="animate-fade-up animate-delay-1 text-charcoal dark:text-dark-text mt-3 font-serif text-[clamp(2rem,5vw,3rem)] leading-[1.15] font-normal tracking-tight">
            {title}
          </h1>
          {authorDetails.length > 0 && (
            <div className="animate-fade-up animate-delay-2 mt-4 flex items-center gap-3">
              {authorDetails.map((author) => (
                <div key={author.name} className="flex items-center gap-2">
                  {author.avatar && (
                    <Image
                      src={author.avatar}
                      width={28}
                      height={28}
                      alt="avatar"
                      className="h-7 w-7 rounded-full"
                    />
                  )}
                  <span className="text-book dark:text-dark-muted text-sm">{author.name}</span>
                </div>
              ))}
            </div>
          )}
        </header>

        <div className="animate-fade-up animate-delay-3 border-divider dark:border-dark-divider border-t">
          <div className="prose dark:prose-invert max-w-none pt-8 pb-8 [&>*]:max-w-[65ch]">
            {children}
          </div>
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
              >
                {next.title} →
              </Link>
            ) : (
              <span />
            )}
          </div>
          <div className="mt-6">
            <Link
              href={`/${basePath}`}
              className="text-muted hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-sm transition-colors"
              aria-label="Back to the blog"
            >
              ← Back to the blog
            </Link>
          </div>
        </footer>
      </article>
    </SectionContainer>
  )
}
