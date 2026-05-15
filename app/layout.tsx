import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://plina.finance"),
  title: "Plina",
  description:
    "Conectando capital global ao direito creditório brasileiro. PLINA-RF: token institucional lastreado em FIDC sob CVM 175, distribuído via Stellar.",
  keywords: [
    "tokenização institucional",
    "direito creditório",
    "FIDC",
    "CVM 175",
    "Stellar",
    "RWA",
    "consórcio contemplado",
    "PLINA-RF",
  ],
  openGraph: {
    title: "Plina",
    description:
      "Conectando capital global ao direito creditório brasileiro. PLINA-RF: token institucional lastreado em FIDC sob CVM 175, distribuído via Stellar.",
    url: "https://plina.finance",
    siteName: "Plina",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Plina",
    description:
      "Conectando capital global ao direito creditório brasileiro via Stellar. FIDC sob CVM 175.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="scroll-smooth">
      <head>
        <link
          href="https://api.fontshare.com/v2/css?f[]=chillax@400,500,600,700&f[]=satoshi@400,500,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500&family=Geist:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-text antialiased min-h-screen flex flex-col relative">
        <a href="#main" className="skip-link">Pular para conteúdo</a>
        <main id="main">{children}</main>
      </body>
    </html>
  );
}
