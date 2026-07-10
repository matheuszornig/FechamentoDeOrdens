import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ApuracaoScreen } from "@/components/apuracao/screen";
import { requireSession } from "@/lib/auth";

export default async function HomePage() {
  const session = await requireSession(await headers());
  if (!session) {
    redirect("/login");
  }

  return (
    <ApuracaoScreen
      userEmail={session.user.email}
      isAdmin={session.user.role === "admin"}
    />
  );
}
