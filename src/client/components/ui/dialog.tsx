import { useRef, type ComponentProps } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '@client/lib/utils';

function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root {...props} />;
}

function DialogOverlay(props: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" {...props} />;
}

function DialogContent({ className, onOpenAutoFocus, onCloseAutoFocus, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Content
      data-slot="dialog-content"
      aria-modal="true"
      className={cn('pointer-events-auto outline-none', className)}
      onOpenAutoFocus={(event) => {
        onOpenAutoFocus?.(event);
        if (event.defaultPrevented) return;

        // FocusScope skips this callback when a child already received focus.
        // Otherwise focus the panel so opening it does not highlight a control or summon a touch keyboard.
        event.preventDefault();
        if (event.target instanceof HTMLElement) {
          const { activeElement, body } = event.target.ownerDocument;
          if (activeElement instanceof HTMLElement && activeElement !== body) openerRef.current = activeElement;
          event.target.focus({ preventScroll: true });
        }
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        const opener = openerRef.current;
        openerRef.current = null;
        if (event.defaultPrevented || !opener?.isConnected) return;

        event.preventDefault();
        if (opener.ownerDocument.activeElement === opener.ownerDocument.body) opener.focus({ preventScroll: true });
      }}
      {...props}
    />
  );
}

function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" {...props} />;
}

function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" {...props} />;
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogTitle };
