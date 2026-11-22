import type { ComponentProps } from 'react';

// Retain browser label behavior, including text selection on double-click.
function Label(props: ComponentProps<'label'>) {
  return <label data-slot="label" {...props} />;
}

export { Label };
