import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";





// Middleware vacío
export function middleware(request: NextRequest) { // eslint-disable-line @typescript-eslint/no-unused-vars
  return NextResponse.next();
}