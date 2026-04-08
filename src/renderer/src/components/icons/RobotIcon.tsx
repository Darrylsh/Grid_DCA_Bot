import React from 'react'

interface RobotIconProps {
  size?: number
  className?: string
}

export const RobotIcon: React.FC<RobotIconProps> = ({ size = 24, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="11" y="2" width="2" height="3" rx="0.5" />
    <rect x="2" y="10" width="3" height="6" rx="1.5" />
    <rect x="19" y="10" width="3" height="6" rx="1.5" />
    <rect x="5" y="5" width="14" height="15" rx="2" />
    <circle cx="9" cy="11" r="1.2" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="15" cy="11" r="1.2" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="9" cy="16" r="0.8" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="12" cy="16" r="0.8" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
    <circle cx="15" cy="16" r="0.8" style={{ fill: 'var(--bg-primary, #0f172a)' }} />
  </svg>
)
