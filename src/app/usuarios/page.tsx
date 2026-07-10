import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UsersScreen } from "@/components/usuarios/screen";
import { requireSession } from "@/lib/auth";

export default async function UsuariosPage() {
  const session = await requireSession(await headers());
  if (!session) {
    redirect("/login");
  }
  // Gestão de usuários é exclusiva do admin — os endpoints do plugin admin
  // revalidam o role no servidor; este redirect é só a camada de UX.
  if (session.user.role !== "admin") {
    redirect("/");
  }

  return <UsersScreen currentUserId={session.user.id} />;
}
