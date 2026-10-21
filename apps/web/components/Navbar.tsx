'use client';
import Link from 'next/link';
import React, { type Dispatch, type SetStateAction, useState, useEffect, useRef } from 'react';
import Button from './Button';
import { usePathname, useRouter } from 'next/navigation';
import { API_URL } from '@/lib/config';

/**
 * First-party Navbar — LOGIC ONLY (spec G2).
 * All styling lives in styles/components/navbar.css.
 */
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

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
    <nav className="navbar">
      <Link href={logoHref} className="navbar__brand" aria-label="ZapMate home">
        <span className="navbar__brand-icon" aria-hidden="true">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            width="20"
            height="20"
          >
            <path
              fillRule="evenodd"
              d="M14.615 1.595a.75.75 0 0 1 .359.852L12.982 9.75h7.268a.75.75 0 0 1 .548 1.262l-10.5 11.25a.75.75 0 0 1-1.272-.71l1.992-7.302H3.75a.75.75 0 0 1-.548-1.262l10.5-11.25a.75.75 0 0 1 .913-.143Z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <span>
          Zap<span className="navbar__brand-accent">Mate</span>
        </span>
      </Link>

      {mounted && isLoggedIn ? (
        <div ref={menuRef} className="navbar__profile">
          <button
            type="button"
            className="navbar__avatar-btn"
            onClick={() => setDropdownVisible(!dropdownVisible)}
            aria-expanded={dropdownVisible}
            aria-haspopup="menu"
            aria-label="Account menu"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              width="20"
              height="20"
            >
              <path
                fillRule="evenodd"
                d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          {dropdownVisible && (
            <div className="navbar__dropdown">
              <button
                type="button"
                className="navbar__dropdown-item"
                onClick={() => {
                  setDropdownVisible(false);
                  router.push('/profile');
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  width="16"
                  height="16"
                >
                  <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
                </svg>
                My Profile
              </button>
              <div className="navbar__dropdown-divider" />
              <button
                type="button"
                className="navbar__dropdown-item navbar__dropdown-item--destructive"
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
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  width="16"
                  height="16"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z"
                    clipRule="evenodd"
                  />
                  <path
                    fillRule="evenodd"
                    d="M19 10a.75.75 0 0 0-.75-.75H8.704l2.47-2.47a.75.75 0 1 0-1.06-1.06l-3.75 3.75a.75.75 0 0 0 0 1.06l3.75 3.75a.75.75 0 1 0 1.06-1.06L8.704 10.75h9.546A.75.75 0 0 0 19 10Z"
                    clipRule="evenodd"
                  />
                </svg>
                Logout
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Desktop buttons */}
          <div className="navbar__desktop-links">
            <Button variant="link" onClick={() => router.push('/login')}>
              Login
            </Button>
            <Button variant="primary" onClick={() => router.push('/sign-up')}>
              Signup
            </Button>
          </div>

          {/* Hamburger button */}
          <button
            type="button"
            className="navbar__hamburger"
            data-open={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <span className="navbar__hamburger-bar" />
            <span className="navbar__hamburger-bar" />
            <span className="navbar__hamburger-bar" />
          </button>

          {/* Mobile menu dropdown */}
          {mobileMenuOpen && (
            <div className="navbar__mobile-menu">
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
