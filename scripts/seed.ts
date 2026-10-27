import "dotenv/config";
import { databaseClient } from "../src/lib/client";

const ids = (process.env.DEMO_GITHUB_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
if (!ids.length || ids.some((id) => !/^[1-9]\d*$/.test(id)) || new Set(ids).size !== ids.length) {
  throw new Error("DEMO_GITHUB_IDS must contain unique numeric GitHub account ids. No data was written.");
}

const db = databaseClient();
try {
  await db.$transaction(async (tx) => {
    const alpha = await tx.team.upsert({ where: { id: "demo-alpha" }, create: { id: "demo-alpha", name: "Demo Alpha" }, update: {} });
    await tx.team.upsert({ where: { id: "demo-beta" }, create: { id: "demo-beta", name: "Demo Beta (separate team)" }, update: {} });
    const beta = await tx.user.upsert({
      where: { id: "demo-beta-member" }, create: { id: "demo-beta-member", name: "Synthetic Beta Member" }, update: {}
    });
    await tx.membership.upsert({
      where: { teamId_userId: { teamId: "demo-beta", userId: beta.id } },
      create: { teamId: "demo-beta", userId: beta.id }, update: {}
    });
    for (const [index, providerAccountId] of ids.entries()) {
      const userId = `github-${providerAccountId}`;
      const existing = await tx.account.findUnique({ where: { provider_providerAccountId: { provider: "github", providerAccountId } } });
      const user = existing ? await tx.user.findUniqueOrThrow({ where: { id: existing.userId } }) :
        await tx.user.upsert({ where: { id: userId }, create: { id: userId, name: `Demo Member ${index + 1}` }, update: {} });
      await tx.account.upsert({
        where: { provider_providerAccountId: { provider: "github", providerAccountId } },
        create: { userId: user.id, type: "oauth", provider: "github", providerAccountId }, update: {}
      });
      await tx.membership.upsert({
        where: { teamId_userId: { teamId: alpha.id, userId: user.id } },
        create: { teamId: alpha.id, userId: user.id }, update: {}
      });
    }
  });
  console.info("Synthetic teams provisioned. Configured GitHub accounts belong to Demo Alpha only.");
} finally {
  await db.$disconnect();
}
