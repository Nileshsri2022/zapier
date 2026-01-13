"use client";
import clsx from 'clsx'
import React from 'react'

const Button = ({ variant, onClick, size="md", children }: {
    variant: "primary" | "secondary" | "link" | "outline",
    onClick: (e: any) => void
    size?: "lg" | "md"
    children?: React.ReactNode
}) => {
  return (
    <button 
        className={clsx("flex items-center px-2 py-1 justify-center rounded-full", {
            "bg-primary-500 font-semibold text-white px-6 py-2 transition-all hover:bg-primary-700 hover:shadow-3xl": variant === "primary",
            "bg-secondary-500 rounded-sm font-semibold text-white hover:bg-secondary-700 transition-all": variant === "secondary",
            "bg-base-100 rounded-sm hover:bg-base-200 font-light text-black": variant === "link",
            "bg-base-100 font-semibold px-6 py-2 transition-all text-black border border-black hover:border-2 hover:border-black": variant === "outline",
            "w-[272px]": size === "lg" 
        })}
        onClick={onClick}
    > {children} </button>
  )
}

export default Button