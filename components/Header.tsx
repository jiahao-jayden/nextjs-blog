"use client"

import { usePathname } from "next/navigation"
import siteMetadata from "@/data/siteMetadata"
import headerNavLinks from "@/data/headerNavLinks"
import Link from "./Link"
import MobileNav from "./MobileNav"
import ThemeSwitch from "./ThemeSwitch"
import SearchButton from "./SearchButton"
import SiteLogo from "./SiteLogo"

const navLinks = headerNavLinks.filter((link) => link.href !== "/")

const HomeHeader = () => (
  <header className="fixed inset-x-0 top-4 z-50 flex justify-center px-4">
    <div className="flex items-center gap-5 rounded-full border border-white/60 bg-white/45 py-2 pr-3 pl-4 shadow-[0_8px_32px_rgb(30_60_90/0.12)] backdrop-blur-md backdrop-saturate-150 sm:gap-7 sm:pr-4 sm:pl-5">
      <Link
        href="/"
        aria-label={siteMetadata.headerTitle}
        className="group flex items-center gap-2"
      >
        <SiteLogo className="text-charcoal h-6 w-6 shrink-0 transition-opacity duration-200 group-hover:opacity-75" />
        <span className="text-charcoal font-serif text-base font-normal transition-opacity duration-200 group-hover:opacity-75">
          {siteMetadata.headerTitle}
        </span>
      </Link>
      <nav className="hidden items-center gap-6 sm:flex">
        {navLinks.map((link) => (
          <Link
            key={link.title}
            href={link.href}
            className="text-inkwell hover:text-charcoal text-sm transition-colors duration-200"
          >
            {link.title}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <SearchButton />
        <MobileNav />
      </div>
    </div>
  </header>
)

const Header = () => {
  const pathname = usePathname()
  if (pathname === "/") return <HomeHeader />

  let headerClass =
    "flex items-center w-full justify-between py-8 border-b border-divider dark:border-dark-divider"
  if (siteMetadata.stickyNav) {
    headerClass += " sticky top-0 z-50 bg-vellum dark:bg-dark-surface"
  }

  return (
    <header className={headerClass}>
      <Link
        href="/"
        aria-label={siteMetadata.headerTitle}
        className="group flex items-center gap-3"
      >
        <SiteLogo className="text-charcoal dark:text-dark-text h-7 w-7 shrink-0 transition-opacity duration-200 group-hover:opacity-75" />
        <span className="text-charcoal dark:text-dark-text font-serif text-xl font-normal transition-opacity duration-200 group-hover:opacity-75">
          {siteMetadata.headerTitle}
        </span>
      </Link>
      <div className="flex items-center gap-6">
        <nav className="hidden items-center gap-6 sm:flex">
          {navLinks.map((link) => (
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
