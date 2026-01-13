import { LoginForm } from '@/components/AuthForm'
import Link from 'next/link'
import React from 'react'

const page = () => {
  return (
    <div className='flex flex-col gap-5 md:flex-row w-full h-full overflow-x-hidden'>
      <h1 className='p-4 absolute text-2xl font-bold translate-y-[-4px] hover:text-primary-500 transition-all'><Link href={"/"}>ZapMate</Link></h1>
        <div className='flex flex-col mt-48 basis-1/2 px-5 md:pl-20 lg:pl-60'>
            <h2 className='font-bold text-[32px] mb-3'>Automate across your teams</h2>
            <p>
              Zapmate Enterprise empowers everyone in your business to securely automate their work in minutes, not months—no coding required.
            </p>
        </div>
        <div className='flex flex-col justify-center basis-1/2 px-5'>
            <h2 className='font-semibold text-2xl mb-3'>Login to your account</h2>
            <LoginForm />
        </div>
    </div>
  )
}

export default page