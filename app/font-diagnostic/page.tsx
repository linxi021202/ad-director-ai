import { FontDiagnosticPageClient } from "@/components/FontDiagnosticPageClient";
import { requirePageUser } from "@/lib/auth/requireUser";

export const dynamic = "force-dynamic";

export default async function FontDiagnosticPage() {
  await requirePageUser("/font-diagnostic");
  return <FontDiagnosticPageClient />;
}