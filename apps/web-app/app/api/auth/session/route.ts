import { NextResponse } from 'next/server';
import { apiError, apiOk, requestId } from '../../../../lib/api.ts';

export async function GET(request: Request) {
  const id = requestId(request);
  return apiOk({ authenticated: true, expiresAt: null }, 200, id);
}
