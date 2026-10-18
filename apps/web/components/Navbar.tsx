'use client';
import Link from 'next/link';
import React, { type Dispatch, type SetStateAction, useState, useEffect } from 'react';
import Button from './Button';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { API_URL } from '@/lib/config';

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

  const menuRef = React.useRef<HTMLDivElement>(null);

  // Close profile dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setDropdownVisible(false);
      }
    };
    if (dropdownVisible) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [dropdownVisible, setDropdownVisible]);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (['/login', '/signup'].includes(pathname)) return <></>;

  // Use "/" as default for SSR, then switch to isLoggedIn-based href after mount
  const logoHref = mounted && isLoggedIn ? '/dashboard' : '/';

  return (
    <nav className="fixed z-50 bg-base-100/90 backdrop-blur w-full px-2 xs:px-3 sm:px-6 md:px-10 h-14 border-b border-border flex items-center justify-between transition-all">
      <Link href={logoHref} className="flex items-center gap-2 font-bold text-lg xs:text-xl sm:text-2xl tracking-tight" aria-label="ZapMate home">
        <span className="grid size-8 place-items-center rounded-lg bg-primary-500 text-white shadow-card" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-5"><path fillRule="evenodd" d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z" clipRule="evenodd" /></svg>
        </span>
        <span>Zap<span className="text-primary-500">Mate</span></span>
      </Link>

      {mounted && isLoggedIn ? (
        <div ref={menuRef} className="relative flex items-center">
          <button
            type="button"
            className="flex justify-center items-center cursor-pointer w-9 h-9 rounded-full bg-primary-500 hover:bg-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-500/30 transition-all text-white shadow-sm"
            onClick={() => setDropdownVisible(!dropdownVisible)}
            aria-expanded={dropdownVisible}
            aria-haspopup="menu"
            aria-label="Account menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="size-5"
            >
              <path
                fillRule="evenodd"
                d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {dropdownVisible && (
            <div className="absolute right-0 top-12 z-50 w-44 p-1.5 bg-card border border-border rounded-lg shadow-lift flex flex-col gap-0.5 animate-slide_in">
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted rounded-md transition-colors font-medium flex items-center gap-2"
                onClick={() => {
                  setDropdownVisible(false);
                  router.push('/profile');
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4 text-muted-foreground">
                  <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                </svg>
                My Profile
              </button>
              <div className="h-px bg-border my-1" />
              <button
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors font-medium flex items-center gap-2"
                onClick={async () => {
                  setDropdownVisible(false);
                  try {
                    await fetch(`${API_URL}/api/auth/logout`, {
                      method: 'POST',
                      credentials: 'include',
                    });
                  } catch (e) {
                    console.error('Logout error:', e);
                  }
                  localStorage.removeItem('user');
                  router.push('/login');
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                  <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l2.47-2.47a.75.75 0 1 0-1.06-1.06l-3.75 3.75a.75.75 0 0 0 0 1.06l3.75 3.75a.75.75 0 1 0 1.06-1.06L8.704 10.75h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
                </svg>
                Logout
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
