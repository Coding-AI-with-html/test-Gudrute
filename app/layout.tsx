import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gudrutės dovanų dėžutės | Pakuota su meile",
  description:
    "Dovanų pakavimo paslaugos ir kruopščiai atrinkti dovanų rinkiniai. Pakuota su meile, sukurta dovanoti.",

  other: {
    "paysera-verify":
      "paysera-verify-4427a57af522475f11e600b5fcd3c737",
  },
};


export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="lt">
      <body>{children}</body>
    </html>
  );
}