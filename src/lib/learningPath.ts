export function interleaveQueues<T>(queues: T[][], limit: number): T[] {
  const result: T[] = [];
  const positions = new Array(queues.length).fill(0);

  while (result.length < limit) {
    let addedThisRound = false;

    for (let queueIndex = 0; queueIndex < queues.length; queueIndex += 1) {
      const queue = queues[queueIndex];
      const position = positions[queueIndex];
      if (position >= queue.length) continue;

      result.push(queue[position]);
      positions[queueIndex] += 1;
      addedThisRound = true;

      if (result.length >= limit) break;
    }

    if (!addedThisRound) break;
  }

  return result;
}
