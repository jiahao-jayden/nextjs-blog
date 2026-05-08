import { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

export default function PageTitle({ children }: Props) {
  return (
    <h1 className="text-charcoal dark:text-dark-text font-serif text-[clamp(2rem,5vw,3rem)] leading-[1.15] font-normal tracking-tight">
      {children}
    </h1>
  )
}
