import { NextResponse } from 'next/server';
import type { ApiFailure, ApiSuccess } from '@/types/api';

/** `{ ok: true, data }`: every successful API response uses this envelope. */
export function ok<T>(data: T, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json<ApiSuccess<T>>(
    { ok: true, data },
    { status: init?.status ?? 200, headers: init?.headers },
  );
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export function failure(
  code: string,
  message: string,
  status: number,
  options?: { fields?: Record<string, string>; headers?: Record<string, string> },
) {
  return NextResponse.json<ApiFailure>(
    { ok: false, error: { code, message, fields: options?.fields } },
    { status, headers: options?.headers },
  );
}
