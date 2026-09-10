import { redirect } from 'next/navigation';
import { requireSession } from '../../lib/auth.ts';
import Dashboard from './view.tsx';
export const dynamic = 'force-dynamic';
export default async function Page() { if (!(await requireSession())) redirect('/auth/login'); return <Dashboard />; }
