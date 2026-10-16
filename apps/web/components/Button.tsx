'use client';
import React from 'react';
import { Button as UIButton, type ButtonProps } from '@/components/ui/button';

type LegacyVariant = 'primary' | 'secondary' | 'link' | 'outline';
type LegacySize = 'lg' | 'md' | 'sm';

const VARIANT_TO_SHADCN: Record<LegacyVariant, NonNullable<ButtonProps['variant']>> = {
  primary: 'default',
  secondary: 'secondary',
  link: 'link',
  outline: 'outline',
};

const SIZE_TO_SHADCN: Record<LegacySize, NonNullable<ButtonProps['size']>> = {
  lg: 'lg',
  md: 'default',
  sm: 'sm',
};

/**
 * First-party Button — LOGIC ONLY (spec G2/D4).
 * - Maps the legacy variant/size API onto the shadcn/ui Button.
 * - Exposes the legacy values as `data-*` hooks so styling lives entirely in
 *   styles/components/button.css (no Tailwind classes in this file).
 * - `className` is forwarded as-is to the vendor layer (it merges with cn()).
 */
const Button = ({
  variant,
  onClick,
  size = 'md',
  children,
  className,
  disabled,
}: {
  variant: LegacyVariant;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: LegacySize;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) => {
  return (
    <UIButton
      variant={VARIANT_TO_SHADCN[variant]}
      size={SIZE_TO_SHADCN[size]}
      data-variant={variant}
      data-size={size}
      className={className}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </UIButton>
  );
};

export default Button;
