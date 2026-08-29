import { prisma } from '../src/lib/prisma';
import { auth } from '../src/lib/auth';
// The seed arrays live in fixtures.ts (side effect free) so the interview
// eval harness (spec 0011) can import them without pulling in the Prisma
// client or better-auth at module load.
import { topics, stories } from './fixtures';

async function main() {
  await prisma.conversationTurn.deleteMany();
  await prisma.story.deleteMany();
  await prisma.topic.deleteMany();

  for (const topic of topics) {
    await prisma.topic.create({ data: topic });
  }

  for (const story of stories) {
    await prisma.story.create({
      data: {
        title: story.title,
        ownership: story.ownership,
        engagement: story.engagement,
        summary: story.summary,
        requiredFraming: story.requiredFraming,
        topics: { connect: story.topics.map((slug) => ({ slug })) },
      },
    });
  }

  const topicCounts = await prisma.topic.findMany({
    select: { slug: true, _count: { select: { stories: true } } },
  });

  const underMapped = topicCounts.filter((t) => t._count.stories < 2);
  if (underMapped.length > 0) {
    throw new Error(
      `Every Topic must map to at least 2 Stories. Under-mapped: ${underMapped
        .map((t) => `${t.slug} (${t._count.stories})`)
        .join(', ')}`,
    );
  }

  console.log(`Seeded ${topics.length} topics and ${stories.length} stories.`);

  await seedAdmin();
}

// The single admin account (INTERNAL_ADMIN_EMAIL/PASSWORD), created directly
// via better-auth's own password hashing so a later sign-in verifies
// correctly. Sign up stays closed (auth.ts's disableSignUp): this seed script
// is the only way this row is ever created. Safe to re-run; updates the
// stored password hash if the env var password has changed.
async function seedAdmin() {
  const email = process.env.INTERNAL_ADMIN_EMAIL;
  const password = process.env.INTERNAL_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('INTERNAL_ADMIN_EMAIL/INTERNAL_ADMIN_PASSWORD not set, skipping admin seed.');
    return;
  }

  const ctx = await auth.$context;
  const hashedPassword = await ctx.password.hash(password);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const id = ctx.generateId({ model: 'user' });
    if (id === false) throw new Error('better-auth did not generate a user id');
    user = await prisma.user.create({
      data: { id, email, name: 'Tony Chou', emailVerified: true },
    });
  }

  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  });
  if (existingAccount) {
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: hashedPassword },
    });
  } else {
    const id = ctx.generateId({ model: 'account' });
    if (id === false) throw new Error('better-auth did not generate an account id');
    await prisma.account.create({
      data: { id, accountId: user.id, providerId: 'credential', userId: user.id, password: hashedPassword },
    });
  }

  console.log(`Seeded admin account: ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
