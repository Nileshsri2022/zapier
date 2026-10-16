import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * shadcn/ui Spinner — vendored vendor-layer utility (spec D2).
 * Ring-style spinner (matches the app's original visual, spec G4).
 * Its utility classes live here (vendor exception), NOT in first-party code.
 */
const Spinner = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-label="loading"
      className={cn(
        'inline-block size-6 animate-spin rounded-full border-[3px] border-current border-t-transparent',
        className
      )}
      {...props}
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
);
Spinner.displayName = 'Spinner';

export { Spinner };
