"use client";
import Link from 'next/link'
import React, { type Dispatch, type SetStateAction } from 'react'
import Button from './Button'
import { usePathname, useRouter } from 'next/navigation'
import clsx from 'clsx';

const Navbar = ({dropdownVisible, setDropdownVisible, session}: {
  dropdownVisible: boolean,
  setDropdownVisible: Dispatch<SetStateAction<boolean>>,
  session: string
}) => {
    const router = useRouter();
    const pathname = usePathname();

    if(["/login", "/signup"].includes(pathname)) return <></>

  return (
    <nav className='fixed z-50 bg-base-100 w-full px-10 h-14 border-b border-gray-300 flex items-center justify-between transition-all overflow-y-visible'>
        <Link href={session ? "/dashboard" : "/"} className='text-primary-500 font-bold text-2xl'>Zap<span className='text-black font-bold'>Mate</span></Link>
        {session ? 
            <div className={clsx(`flex flex-col items-end gap-2`, {
              "mt-[5.5rem]": dropdownVisible === true
            })}>
              <div 
                className='flex justify-center items-center cursor-pointer w-10 h-10 rounded-full bg-primary-500 hover:bg-primary-700 hover:shadow-2xl transition-all'
                onClick={() => setDropdownVisible(!dropdownVisible)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFFFFF" className="size-5">
                  <path fillRule="evenodd" d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z" clipRule="evenodd" />
                </svg>  
              </div>
              {
                dropdownVisible && (<div className='bg-white z-50 w-40 h-20 p-2 border border-gray-300 rounded-sm flex flex-col gap-2 transition-all'>
                  <div className='border-b text-gray-500 cursor-pointer hover:bg-base-200 px-1 text-nm border-gray-300' onClick={() => {
                    localStorage.setItem("token", "");
                    router.push("/login")
                  }}>Logout</div>
                  <div className='border-b text-gray-500 cursor-pointer hover:bg-base-200 px-1 text-nm border-gray-300'>My Profile</div>
                </div>)
              }
            </div>
        : 
          <div className='flex gap-2'>
            <Button variant='link' onClick={() => router.push("/login")}>Login</Button>
            <Button variant='primary' onClick={() => router.push("/sign-up")}>Signup</Button>
          </div>
        }
    </nav>
  )
}

export default Navbar