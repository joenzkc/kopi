import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@client/lib/utils';

const cardVariants = cva('', {
  variants: {
    variant: {
      default: 'card',
      flat: 'bg-card',
      outline: 'border border-border bg-card',
      subtle: 'bg-secondary',
      unstyled: '',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Card({
  as: Element = 'div',
  asChild = false,
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof cardVariants> & {
  as?: 'article' | 'div' | 'section';
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : Element;
  return <Comp data-slot="card" className={cn(cardVariants({ variant }), className)} {...props} />;
}

export { Card };
