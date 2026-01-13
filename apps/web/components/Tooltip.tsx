import React, { type ReactNode } from 'react'

const Tooltip = ({children, tooltipText}: {
  children: ReactNode,
  tooltipText: String
}) => {
  return (
    <div className="relative group">
    {children}
    <div className="absolute bottom-full left-1/2 transform translate-y-1 -translate-x-1/2 mb-3 border border-gray-500 bg-white text-gray-500 text-sm rounded py-1 px-2 w-max max-w-[500px] sm:max-w-[300px] md:max-w-[400px] lg:max-w-[500px] opacity-0 group-hover:opacity-100 transition-opacity duration-300 break-words">
      {tooltipText}
      <div className="absolute top-full left-1/2 transform -translate-y-[5px] -translate-x-1/2 w-3 h-3 bg-white rotate-45 border-b border-r border-gray-500"></div>
    </div>
  </div>

  )
}

export default Tooltip