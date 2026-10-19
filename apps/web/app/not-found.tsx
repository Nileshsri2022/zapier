import Image from 'next/image';
import React from 'react';
import ErrorImage from '../public/404.svg';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="not-found">
      <Image src={ErrorImage} alt="404 Not Found" />
      <p className="not-found__title">Page not found!</p>
      <Link href={'/'} className="not-found__link">
        Return to homepage
      </Link>
    </div>
  );
}
