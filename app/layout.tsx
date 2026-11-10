import type { Metadata } from "next";
import "./globals.css";
import localFont from "next/font/local";
import { Telemetry } from "@/components/Telemetry";
import { BotIdClient } from "botid/client";
import { AppProviders } from "@/components/AppProviders";
import { AppShell } from "@/components/AppShell";
import { isAdminAuthenticated } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/get-locale";
import { ItfFontFaces } from "@/components/ItfFontFaces";

// Geist e Geist Mono (OFL): arquivos no repo, self-host (sem pedido externo).
// Chillax/Satoshi (ITF) ficam fora do Git: ver components/ItfFontFaces.tsx.
const geist = localFont({
  src: "./fonts/Geist-Variable-latin.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/GeistMono-Variable-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const { locale, dict } = await getDictionary();
  return {
    metadataBase: new URL("https://plina.finance"),
    title: dict.meta.title,
    description: dict.meta.description,
    keywords: dict.meta.keywords,
    openGraph: {
      title: dict.meta.title,
      description: dict.meta.description,
      url: "https://plina.finance",
      siteName: "Plina",
      locale: locale === "pt-BR" ? "pt_BR" : "en_US",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: dict.meta.title,
      description: dict.meta.twitterDescription,
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [isAdmin, params, { locale, dict }] = await Promise.all([
    isAdminAuthenticated(),
    db.parametrosPool
      .findUnique({ where: { id: "singleton" } })
      .catch(() => null),
    getDictionary(),
  ]);
  const issuerPubkey =
    params?.issuerPubkey ?? process.env.STELLAR_ISSUER_PUBLIC ?? "";

  return (
    <html
      lang={locale}
      className={`scroll-smooth ${geist.variable} ${geistMono.variable}`}
      // O script da landing põe `reveal-ready` aqui antes da primeira pintura.
      suppressHydrationWarning
    >
      <head>
        <ItfFontFaces />
      </head>
      <body className="font-text antialiased min-h-screen flex flex-col relative">
        {/* F-M0-5: sem isso, o servidor nunca recebe prova de "humano" e
            checkBotId() classifica toda requisição como bot (403 sempre,
            em qualquer navegador — descoberto 2026-07-01).
            Só em produção: o script de desafio (Kasada) depende de
            infraestrutura de edge da Vercel que não existe em `next dev` —
            lá, getChallenge() nunca resolve e o fetch protegido trava pra
            sempre (descoberto 2026-07-01, travamento eterno em "Enviando…"
            no /vender). checkBotId() já tem esse bypass server-side; aqui
            replicamos pro client. */}
        {process.env.NODE_ENV === "production" && (
          <BotIdClient
            protect={[
              { path: "/api/vender/lead", method: "POST" },
              { path: "/api/comprar/lead", method: "POST" },
            ]}
          />
        )}
        <a href="#main" className="skip-link">Pular para conteúdo</a>
        <AppProviders>
          <AppShell isAdmin={isAdmin} issuerPubkey={issuerPubkey}>
            <div id="main">{children}</div>
          </AppShell>
        </AppProviders>
        <Telemetry />
      </body>
    </html>
  );
}
