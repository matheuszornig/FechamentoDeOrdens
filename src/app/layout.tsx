import type { Metadata } from "next";
import { Fira_Code } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fechamento de Ordens — BTG",
  description:
    "Apuração on-demand de resultados de renda variável via API de notas de corretagem do BTG Pactual",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${firaCode.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
