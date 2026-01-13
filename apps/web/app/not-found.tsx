"use client";
import Image from 'next/image'
import React from 'react'
import ErrorImage from "../public/404.svg"
import Link from 'next/link';

const error = () => {
  return (
    <div className='w-screen h-screen flex flex-col justify-center items-center bg-base-100'>
        <Image src={ErrorImage} alt="404 Not Found"/>
        <p className='font-bold text-3xl mb-3'>Page not found!</p>
        <Link href={"/"} className='font-semibold underline underline-offset-2 hover:text-primary-500 transition-all'>Return to homepage</Link>
    </div>
  )
}

export default error