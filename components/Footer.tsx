import Link from './Link'
import siteMetadata from '@/data/siteMetadata'

export default function Footer() {
  return (
    <footer className="border-divider dark:border-dark-divider mt-16 border-t pt-8 pb-12">
      <div className="text-muted dark:text-dark-muted flex flex-col items-center gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span>{siteMetadata.author}</span>
          <span>·</span>
          <span>{`© ${new Date().getFullYear()}`}</span>
          <span>·</span>
          <Link
            href="/"
            className="hover:text-charcoal dark:hover:text-dark-text transition-colors"
          >
            {siteMetadata.title}
          </Link>
        </div>
        <div className="flex items-center gap-4">
          {siteMetadata.github && (
            <Link
              href={siteMetadata.github}
              className="hover:text-charcoal dark:hover:text-dark-text transition-colors"
            >
              GitHub
            </Link>
          )}
          {siteMetadata.x && (
            <Link
              href={siteMetadata.x}
              className="hover:text-charcoal dark:hover:text-dark-text transition-colors"
            >
              X
            </Link>
          )}
          <Link
            href="/feed.xml"
            className="hover:text-charcoal dark:hover:text-dark-text transition-colors"
          >
            RSS
          </Link>
        </div>
      </div>
    </footer>
  )
}
