import { prisma } from '../src/lib/prisma';

async function main() {
  await prisma.post.deleteMany();
  await prisma.author.deleteMany();

  const ada = await prisma.author.create({
    data: {
      name: 'Ada Lovelace',
      posts: {
        create: [
          { title: 'Notes on the Analytical Engine' },
          { title: 'On computing machinery' },
        ],
      },
    },
  });

  const grace = await prisma.author.create({
    data: {
      name: 'Grace Hopper',
      posts: {
        create: [{ title: 'Nothing is impossible to compute' }],
      },
    },
  });

  console.log(`Seeded authors: ${ada.name}, ${grace.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
