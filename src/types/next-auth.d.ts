import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & { id: string };
    selectedOrgId: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    selectedOrgId: string | null;
  }
}
