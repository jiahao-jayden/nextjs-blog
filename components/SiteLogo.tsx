type SiteLogoProps = {
  className?: string
}

const SiteLogo = ({ className }: SiteLogoProps) => (
  <svg
    viewBox="0 0 64 64"
    aria-hidden="true"
    focusable="false"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path fill="currentColor" d="M10 8h4v48h-4zM18 8h4v48h-4zM26 8h4v48h-4z" />
    <path fill="currentColor" d="M36 8h12l8 8v40H36z" />
  </svg>
)

export default SiteLogo
