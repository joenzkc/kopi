import { useState } from 'react';
import { Toast as ToastPrimitive } from 'radix-ui';
import { cn } from '@client/lib/utils';
import { useFinancialValues } from '@client/lib/valueVisibility';

type ToastMessage = { msg: string; tone: 'success' | 'error'; privateMessage?: string };

function Toaster({ notification }: { notification: ToastMessage | null }) {
  const { valuesHidden } = useFinancialValues();
  const message = valuesHidden ? notification?.privateMessage ?? notification?.msg : notification?.msg;
  // The persistent polite region below announces each message as its text changes.
  const [announcerContainer] = useState(() => document.createDocumentFragment());

  return (
    <ToastPrimitive.Provider duration={Infinity} announcerContainer={announcerContainer}>
      {/* Keep this passive layer mounted so messages never take Escape priority from an open dialog. */}
      <ToastPrimitive.Root
        data-slot="toast"
        forceMount
        open={notification !== null}
        hidden={!notification}
        tabIndex={-1}
        className={cn(
          'rounded-full px-4 py-2.5 text-label font-bold text-background shadow-lg',
          notification?.tone === 'error' ? 'bg-destructive' : 'bg-foreground',
        )}
      >
        <span aria-hidden="true">{message}</span>
      </ToastPrimitive.Root>
      <div inert>
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          hotkey={[]}
          label="Notifications"
          className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex justify-center px-4 md:bottom-8"
        />
      </div>
      <div role="status" aria-live="polite" className="sr-only">{message}</div>
    </ToastPrimitive.Provider>
  );
}

export { Toaster };
export type { ToastMessage };
