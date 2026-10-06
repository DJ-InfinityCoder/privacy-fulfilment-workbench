import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { cookies } from "next/headers";
import { Archive, Fingerprint } from "lucide-react";
import { AIStatusBadge } from "@/components/ai-status-badge";
import { AppProviders } from "@/components/app-providers";
import { RoleSwitcher } from "@/components/role-switcher";
import { MobileNavigation } from "@/components/mobile-navigation";
import { SidebarNav } from "@/components/sidebar-nav";
import { mockRoleCookieName, parseMockRole } from "@/lib/mock-auth";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Privacy Workbench",
  description: "Internal privacy-operations request fulfilment workbench.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const currentRole = parseMockRole(cookieStore.get(mockRoleCookieName)?.value);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <AppProviders>
          <div className="flex min-h-screen">
            <aside className="hidden w-64 shrink-0 border-r bg-card md:sticky md:top-0 md:flex md:h-screen md:flex-col">
              <Link href="/" className="flex h-16 shrink-0 items-center gap-3 border-b px-6">
                <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Fingerprint className="size-5" aria-hidden="true" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold tracking-tight">
                    Privacy Workbench
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Operations console
                  </span>
                </span>
              </Link>
              <SidebarNav />
              <div className="shrink-0 border-t p-4">
                <div className="flex items-center gap-3 rounded-md bg-muted/60 p-3">
                  <span className="flex size-9 items-center justify-center rounded-md bg-background text-muted-foreground">
                    <Archive className="size-4" aria-hidden="true" />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xs font-medium">Mock workspace</span>
                    <span className="text-xs text-muted-foreground">
                      No live data connected
                    </span>
                  </span>
                </div>
              </div>
            </aside>
            <div className="flex min-w-0 flex-1 flex-col">
              <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background/95 px-5 backdrop-blur md:px-8">
                <div className="flex items-center gap-3">
                  <MobileNavigation />
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
                        Privacy Operations
                      </span>
                      <span className="rounded bg-muted/80 px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                        v2025.1
                      </span>
                    </div>
                    <p className="text-sm font-semibold tracking-tight text-foreground">
                      Request Fulfilment
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <AIStatusBadge />
                  <div className="hidden h-5 w-px bg-border sm:block" />
                  <RoleSwitcher initialRole={currentRole} />
                </div>
              </header>
              <main className="flex-1 px-5 py-8 md:px-8">{children}</main>
              <footer className="border-t bg-card/50 px-5 py-4 md:px-8">
                <p className="mx-auto max-w-6xl text-xs leading-relaxed text-muted-foreground">
                  This tool follows internal organizational policy only. It does
                  not provide legal advice or guarantee compliance with any law
                  or regulation. Final decisions rest with authorized staff.
                </p>
              </footer>
            </div>
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
