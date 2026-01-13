import React from 'react'
import { SignupForm } from '@/components/AuthForm'
import Link from 'next/link'

const page = () => {
  return (
    <div className='flex flex-col gap-5 md:flex-row w-full h-full overflow-x-hidden'>
      <h1 className='p-4 absolute text-2xl font-bold translate-y-[-4px] hover:text-primary-500 transition-all'><Link href={"/"}>ZapMate</Link></h1>

        <div className='flex flex-col justify-center basis-1/2 px-5 md:pl-20 lg:pl-60'>
            <h2 className='font-bold text-[32px] mb-10'>Join millions worldwide who automate their work using ZapMate.</h2>
            <ul className='flex flex-col gap-6'>
                <li className='flex gap-1'>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0f884e" className="size-6">
                        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                    </svg>
                    <p>Easy setup, no coding required</p>
                </li>
                <li className='flex gap-1'>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0f884e" className="size-6">
                        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                    </svg>
                    <p>Free forever for core features</p>
                </li>
                <li className='flex gap-1'>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0f884e" className="size-6">
                        <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z" clipRule="evenodd" />
                    </svg>
                    <p>14-day trial of premium features & apps</p>
                </li>
            </ul>
        </div>
        <div className='flex flex-col justify-center basis-1/2 px-5'>
            <SignupForm />
        </div>
    </div>
  )
}

export default page