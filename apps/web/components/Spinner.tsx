import clsx from 'clsx'
import React from 'react'

const Spinner = ({color}: {
  color: string
}) => {
  return (
    <div className={clsx(`animate-spin inline-block size-6 border-[3px] border-current border-t-transparent  rounded-full`, {
      "text-primary-500 dark:text-primary-500": color === "primary",
      "text-white dark:text-white": color === "white"
    })} role="status" aria-label="loading">
        <span className="sr-only">Loading...</span>
    </div>
  )
}

export default Spinner