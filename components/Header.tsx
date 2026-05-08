import siteMetadata from '@/data/siteMetadata'
import headerNavLinks from '@/data/headerNavLinks'
import Link from './Link'
import MobileNav from './MobileNav'
import ThemeSwitch from './ThemeSwitch'
import SearchButton from './SearchButton'

const Header = () => {
  let headerClass =
    'flex items-center w-full justify-between py-8 border-b border-divider dark:border-dark-divider'
  if (siteMetadata.stickyNav) {
    headerClass += ' sticky top-0 z-50 bg-vellum dark:bg-dark-surface'
  }

  return (
    <header className={headerClass}>
      <Link href="/" aria-label={siteMetadata.headerTitle}>
        <span className="text-charcoal dark:text-dark-text font-serif text-xl font-normal">
          {siteMetadata.headerTitle}
        </span>
      </Link>
      <div className="flex items-center gap-6">
        <nav className="hidden items-center gap-6 sm:flex">
          {headerNavLinks
            .filter((link) => link.href !== '/')
            .map((link) => (
              <Link
                key={link.title}
                href={link.href}
                className="text-inkwell hover:text-charcoal dark:text-dark-muted dark:hover:text-dark-text text-sm transition-colors duration-200"
              >
                {link.title}
              </Link>
            ))}
        </nav>
        <SearchButton />
        <ThemeSwitch />
        <MobileNav />
      </div>
    </header>
  )
}

export default Header
