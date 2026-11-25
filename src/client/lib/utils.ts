import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the custom type-scale sizes (index.css @theme --text-*), otherwise it treats
// `text-label` etc. as text colours and drops e.g. `text-primary-foreground` when both are present.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['entry', 'display', 'title', 'stat', 'heading', 'body', 'label', 'caption'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
