import { load } from '@std/dotenv';
import { PgBoss } from 'pg-boss';

await load({ export: true });
const boss = new PgBoss({
  connectionString: Deno.env.get('POSTGRES_DB_URL') ?? '',
});
await boss.start();
boss.on('error', console.error);

const queue = 'readme-queue';
const dlq = 'readme-dlq';
const saadQ = await boss.deleteQueue('saad');
console.log(saadQ);

await boss.deleteQueue(queue);
await boss.deleteQueue(dlq);

await boss.createQueue(dlq);
await boss.createQueue(queue, { deadLetter: dlq });

await boss.work(queue, async ([job]) => {
  console.log(`work 1 received job ${job.id} with data ${JSON.stringify(job)}`);
  throw new Error('Testing errors');
});
await boss.work(queue, async ([job]) => {
  console.log(`work 2received job ${job.id} with data ${JSON.stringify(job)}`);
});

let id = await boss.send(queue, { arg1: 'read me' }, {
  retryLimit: 0,
});

console.log({ id });

id = await boss.send(queue, { arg1: 'read me 2' }, {
  retryLimit: 0,
});

console.log({ id });

id = await boss.send(queue, { arg1: 'read me 3' }, {
  retryLimit: 0,
});

console.log({ id });

id = await boss.send(queue, { arg1: 'read me 4' }, {
  retryLimit: 0,
});

console.log({ id });

id = await boss.send(queue, { arg1: 'read me 5' }, {
  retryLimit: 0,
});

console.log({ id });

while (true) {
  const resp = await boss.getQueueStats(queue);
  if (resp.activeCount === 0 && resp.queuedCount === 0) break;
  await new Promise((res) => setTimeout(res, 1000));
  //console.log('Trying again');
}

// Fetch and print jobs from the dead letter queue
const dlqJobs = await boss.fetch(dlq, { batchSize: 10 });
console.log('Dead letter queue jobs:', JSON.stringify(dlqJobs, null, 2));

await boss.stop();
