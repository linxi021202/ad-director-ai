import { NextResponse } from "next/server";

import {
  AnonymousProjectLimitError,
  createColdBrewDemoForSession,
  listAnonymousProjects
} from "@/lib/projects/anonymousProjectStore";
import { requireAnonymousSession } from "@/lib/session/anonymousSession";

export async function GET(request: Request) {
  const session = await requireAnonymousSession();
  try {
    const record = await createColdBrewDemoForSession(session.id);
    return NextResponse.redirect(new URL(`/projects/${record.id}`, request.url));
  } catch (error) {
    if (error instanceof AnonymousProjectLimitError) {
      const existing = await listAnonymousProjects(session.id);
      const target = existing[0]?.id;
      return NextResponse.redirect(new URL(target ? `/projects/${target}` : "/projects", request.url));
    }
    throw error;
  }
}