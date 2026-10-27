import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  providers: [GitHub],
  callbacks: {
    async signIn({ account }) {
      if (account?.provider !== "github") return false;
      const allowed = await db.account.findUnique({
        where: { provider_providerAccountId: { provider: "github", providerAccountId: account.providerAccountId } },
        include: { user: { include: { memberships: true } } }
      });
      return Boolean(allowed?.user.memberships.length);
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    }
  },
  pages: { signIn: "/signin", error: "/signin" }
});
