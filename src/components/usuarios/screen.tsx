"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, UserPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authClient } from "@/lib/auth-client";
import { formatDateBR } from "@/lib/format";

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  createdAt: Date | string;
}

/** Erros do Better Auth chegam como {error: {message}} — extrai legível. */
function errMessage(error: { message?: string } | null): string {
  return error?.message ?? "Erro inesperado";
}

function NewUserCard({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.admin.createUser({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (error) throw new Error(errMessage(error));
    },
    onSuccess: () => {
      toast.success(`Usuário ${email.trim()} criado`);
      setName("");
      setEmail("");
      setPassword("");
      onCreated();
    },
    onError: (err) =>
      toast.error("Não foi possível criar o usuário", {
        description: err.message,
      }),
  });

  const valid =
    name.trim().length > 0 && email.includes("@") && password.length >= 8;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Novo usuário</CardTitle>
        <CardDescription>
          O usuário entra com e-mail e senha definidos aqui (mínimo de 8
          caracteres) — compartilhe a senha por um canal seguro.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="novo-nome">Nome</Label>
            <Input
              id="novo-nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome completo"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="novo-email">E-mail</Label>
            <Input
              id="novo-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@exemplo.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="novo-senha">Senha</Label>
            <Input
              id="novo-senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mín. 8 caracteres"
            />
          </div>
          <Button
            type="submit"
            disabled={!valid || create.isPending}
            className="sm:mb-[1px]"
          >
            <UserPlus className="mr-1 size-4" aria-hidden />
            {create.isPending ? "Criando…" : "Criar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function UsersScreen({ currentUserId }: { currentUserId: string }) {
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await authClient.admin.listUsers({
        query: { limit: 100, sortBy: "createdAt", sortDirection: "asc" },
      });
      if (error) throw new Error(errMessage(error));
      return data.users as AdminUser[];
    },
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });

  const toggleBan = useMutation({
    mutationFn: async (user: AdminUser) => {
      const { error } = user.banned
        ? await authClient.admin.unbanUser({ userId: user.id })
        : await authClient.admin.banUser({ userId: user.id });
      if (error) throw new Error(errMessage(error));
      return user.banned ? "reativado" : "desativado";
    },
    onSuccess: (acao) => {
      toast.success(`Usuário ${acao}`);
      refresh();
    },
    onError: (err) =>
      toast.error("Não foi possível alterar o acesso", {
        description: err.message,
      }),
  });

  const resetPassword = useMutation({
    mutationFn: async ({ user }: { user: AdminUser }) => {
      // Prompt nativo: fluxo raro (redefinição pelo admin), sem estado de UI.
      const newPassword = window.prompt(
        `Nova senha para ${user.email} (mín. 8 caracteres):`,
      );
      if (!newPassword) return null;
      if (newPassword.length < 8) {
        throw new Error("A senha deve ter pelo menos 8 caracteres.");
      }
      const { error } = await authClient.admin.setUserPassword({
        userId: user.id,
        newPassword,
      });
      if (error) throw new Error(errMessage(error));
      return user.email;
    },
    onSuccess: (email) => {
      if (email) toast.success(`Senha de ${email} redefinida`);
    },
    onError: (err) =>
      toast.error("Não foi possível redefinir a senha", {
        description: err.message,
      }),
  });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">
            Acessos ao Fechamento de Ordens — todos os usuários podem consultar
            qualquer conta.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href="/" />}>
          <ArrowLeft className="mr-1 size-4" aria-hidden />
          Voltar
        </Button>
      </header>

      <NewUserCard onCreated={refresh} />

      <Card>
        <CardHeader>
          <CardTitle>Usuários cadastrados</CardTitle>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : usersQuery.isError ? (
            <p className="py-4 text-sm text-destructive">
              {usersQuery.error.message}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Criado em</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(usersQuery.data ?? []).map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.name}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <Badge
                          variant={u.role === "admin" ? "default" : "secondary"}
                        >
                          {u.role === "admin" ? "Admin" : "Usuário"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.banned ? "destructive" : "secondary"}>
                          {u.banned ? "Desativado" : "Ativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatDateBR(String(u.createdAt).slice(0, 10))}
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => resetPassword.mutate({ user: u })}
                          disabled={resetPassword.isPending}
                        >
                          <KeyRound className="mr-1 size-3.5" aria-hidden />
                          Senha
                        </Button>
                        {u.id !== currentUserId && (
                          <Button
                            variant={u.banned ? "outline" : "destructive"}
                            size="sm"
                            onClick={() => toggleBan.mutate(u)}
                            disabled={toggleBan.isPending}
                          >
                            {u.banned ? "Reativar" : "Desativar"}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
