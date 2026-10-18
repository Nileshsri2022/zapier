import Link from 'next/link';
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

/** Link that looks like <Button> — same data-* hooks, so button.css styles both. */
export default function ButtonLink({
  href,
  variant,
  size = 'md',
  children,
}: {
  href: string;
  variant: LegacyVariant;
  size?: LegacySize;
  children: React.ReactNode;
}) {
  return (
    <UIButton
      asChild
      variant={VARIANT_TO_SHADCN[variant]}
      size={SIZE_TO_SHADCN[size]}
      data-variant={variant}
      data-size={size}
    >
      <Link href={href}>{children}</Link>
    </UIButton>
  );
}
