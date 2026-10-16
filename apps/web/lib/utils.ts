import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn/ui class-merge helper.
 * Only allowed inside `components/ui/**` (first-party components must not
 * concatenate class names — see reports/shadcn-migration-spec.md, D4).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
