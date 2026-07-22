import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(input) {
        const parsed = credentialsSchema.safeParse(input);
        if (!parsed.success) return null;

        const user = await db.user.findUnique({
          where: { email: parsed.data.email },
        });
        if (!user?.passwordHash) return null;

        const validPassword = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!validPassword) return null;

        return user;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id;
        const membership = await db.membership.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
          select: { orgId: true },
        });
        token.selectedOrgId = membership?.orgId ?? null;
      }

      if (
        trigger === "update" &&
        typeof token.userId === "string" &&
        typeof session?.selectedOrgId === "string"
      ) {
        const membership = await db.membership.findUnique({
          where: {
            orgId_userId: { orgId: session.selectedOrgId, userId: token.userId },
          },
          select: { orgId: true },
        });
        if (membership) token.selectedOrgId = membership.orgId;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.userId !== "string") throw new Error("Authenticated session has no user id");
      session.user.id = token.userId;
      session.selectedOrgId = typeof token.selectedOrgId === "string" ? token.selectedOrgId : null;
      return session;
    },
  },
});
