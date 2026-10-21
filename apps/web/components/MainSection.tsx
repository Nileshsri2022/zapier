'use client';
import React, { useState } from 'react';
import Navbar from './Navbar';
import { getSessionDetails } from '@/helper';

/**
 * First-party MainSection — LOGIC ONLY (spec G2).
 * Styles live in styles/base.css (.main-shell, .main-content).
 */
function MainSection({ children }: { children?: React.ReactNode }) {
  const session = getSessionDetails();
  const [dropdownVisible, setDropdownVisible] = useState<boolean>(false);

  return (
    <div className="main-shell" onClick={() => dropdownVisible && setDropdownVisible(false)}>
      <Navbar
        dropdownVisible={dropdownVisible}
        setDropdownVisible={setDropdownVisible}
        isLoggedIn={session.isLoggedIn}
      />
      <div className="main-content">{children}</div>
    </div>
  );
}

export default MainSection;
