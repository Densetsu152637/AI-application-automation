import type { ReactNode } from 'react';
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body style={{ fontFamily: 'system-ui', margin: 0, background: '#f5f7fb', color: '#172033' }}>{children}</body></html>;
}
