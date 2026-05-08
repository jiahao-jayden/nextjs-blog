'use client'

import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react'
import { Fragment, useEffect, useRef, useState } from 'react'
import headerNavLinks from '@/data/headerNavLinks'
import Link from './Link'

const MobileNav = () => {
  const [navShow, setNavShow] = useState(false)
  const navRef = useRef<HTMLElement | null>(null)

  const openNav = () => setNavShow(true)
  const closeNav = () => setNavShow(false)

  useEffect(() => {
    if (navShow) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [navShow])

  return (
    <>
      <button type="button" aria-label="Toggle Menu" onClick={openNav} className="sm:hidden">
        <svg
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-charcoal dark:text-dark-text h-6 w-6"
        >
          <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>
      <Transition appear show={navShow} as={Fragment}>
        <Dialog as="div" open={navShow} onClose={closeNav} className="relative z-50">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="bg-charcoal/20 fixed inset-0 z-60 dark:bg-black/40" />
          </TransitionChild>

          <TransitionChild
            as={Fragment}
            enter="transition ease-out duration-300 transform"
            enterFrom="translate-x-full"
            enterTo="translate-x-0"
            leave="transition ease-in duration-200 transform"
            leaveFrom="translate-x-0"
            leaveTo="translate-x-full"
          >
            <DialogPanel className="bg-vellum dark:bg-dark-surface fixed top-0 right-0 z-70 h-full w-3/4 max-w-sm shadow-lg">
              <button
                type="button"
                className="text-charcoal dark:text-dark-text absolute top-6 right-6 p-2"
                aria-label="Close Menu"
                onClick={closeNav}
              >
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="h-6 w-6"
                >
                  <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>

              <nav ref={navRef} className="flex h-full flex-col justify-center gap-8 px-12">
                {headerNavLinks.map((link) => (
                  <Link
                    key={link.title}
                    href={link.href}
                    className="text-charcoal dark:text-dark-text font-serif text-2xl transition-opacity hover:opacity-70"
                    onClick={closeNav}
                  >
                    {link.title}
                  </Link>
                ))}
              </nav>
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>
    </>
  )
}

export default MobileNav
