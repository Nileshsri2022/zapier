'use client';
import Link from 'next/link';
import React, { type Dispatch, type SetStateAction, useState, useEffect } from 'react';
import Button from './Button';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';

const Navbar = ({
  dropdownVisible,
  setDropdownVisible,
  isLoggedIn,
}: {
  dropdownVisible: boolean;
  setDropdownVisible: Dispatch<SetStateAction<boolean>>;
  isLoggedIn: boolean;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (['/login', '/signup'].includes(pathname)) return <></>;

  // Use "/" as default for SSR, then switch to isLoggedIn-based href after mount
  const logoHref = mounted && isLoggedIn ? '/dashboard' : '/';

  return (
    <nav className="fixed z-50 bg-base-100/90 backdrop-blur w-full px-2 xs:px-3 sm:px-6 md:px-10 h-14 border-b border-border flex items-center justify-between transition-all overflow-y-visible">
      <Link href={logoHref} className="flex items-center gap-2 font-bold text-lg xs:text-xl sm:text-2xl tracking-tight" aria-label="ZapMate home">
        <span className="grid size-8 place-items-center rounded-lg bg-primary-500 text-white shadow-card" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-5"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clipRule="evenodd" /></svg>
        </span>
        <span>Zap<span className="text-primary-500">Mate</span></span>
      </Link>

      {mounted && isLoggedIn ? (
        <div
          className={clsx(`flex flex-col items-end gap-2`, {
            'mt-[5.5rem]': dropdownVisible === true,
          })}
        >
          <div
            className="flex justify-center items-center cursor-pointer w-10 h-10 rounded-full bg-primary-500 hover:bg-primary-700 hover:shadow-2xl transition-all"
            onClick={() => setDropdownVisible(!dropdownVisible)} aria-expanded={dropdownVisible} aria-haspopup="menu" aria-label="Account menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="#FFFFFF"
              className="size-5"
            >
              <path
                fillRule="evenodd"
                d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          {dropdownVisible && (
            <div className="bg-white z-50 w-40 h-20 p-2 border border-gray-300 rounded-sm flex flex-col gap-2 transition-all">
              <button type="button"
                className="border-b text-left text-gray-500 cursor-pointer hover:bg-base-200 px-1 text-nm border-gray-300"
                onClick={async () => {
                  // Call logout API to clear httpOnly cookie
                  try {
                    await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/auth/logout`, {
                      method: 'POST',
                      credentials: 'include',
                    });
                  } catch (e) {
                    console.error('Logout error:', e);
                  }
                  // Clear local user data
                  localStorage.removeItem('user');
                  router.push('/login');
                }}
              >
                Logout
              </button>
              <button type="button"
                className="border-b text-left text-gray-500 cursor-pointer hover:bg-base-200 px-1 text-nm border-gray-300"
                onClick={() => {
                  setDropdownVisible(false);
                  router.push('/profile');
                }}
              >
                My Profile
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Desktop buttons - hidden on mobile */}
          <div className="hidden sm:flex gap-2">
            <Button variant="link" onClick={() => router.push('/login')}>
              Login
            </Button>
            <Button variant="primary" onClick={() => router.push('/sign-up')}>
              Signup
            </Button>
          </div>

          {/* Hamburger button - visible on mobile only */}
          <button
            className="sm:hidden flex flex-col justify-center items-center w-10 h-10 gap-1.5"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu" aria-expanded={mobileMenuOpen}
          >
            <span
              className={clsx('w-6 h-0.5 bg-gray-700 transition-all duration-300', {
                'rotate-45 translate-y-2': mobileMenuOpen,
              })}
            />
            <span
              className={clsx('w-6 h-0.5 bg-gray-700 transition-all duration-300', {
                'opacity-0': mobileMenuOpen,
              })}
            />
            <span
              className={clsx('w-6 h-0.5 bg-gray-700 transition-all duration-300', {
                '-rotate-45 -translate-y-2': mobileMenuOpen,
              })}
            />
          </button>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="absolute top-14 left-0 right-0 bg-white border-b border-gray-300 sm:hidden p-4 flex flex-col gap-3 shadow-lg animate-slide_in">
              <Button
                variant="link"
                onClick={() => {
                  setMobileMenuOpen(false);
                  router.push('/login');
                }}
              >
                Login
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setMobileMenuOpen(false);
                  router.push('/sign-up');
                }}
              >
                Signup
              </Button>
            </div>
          )}
        </>
      )}
    </nav>
  );
};

export default Navbar;
