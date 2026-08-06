import { prisma } from '../src/lib/prisma';

async function main() {
  try {
    const count = await prisma.topic.count();
    console.log(`✅ Connected (found ${count} topic row(s))`);
  } catch (error) {
    console.error('❌ Prisma connection failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
