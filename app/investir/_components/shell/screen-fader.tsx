import type { ReactNode } from 'react';

export function ScreenFader({ children }: { children: ReactNode }) {
  return <div className="animate-screen-in">{children}</div>;
}
