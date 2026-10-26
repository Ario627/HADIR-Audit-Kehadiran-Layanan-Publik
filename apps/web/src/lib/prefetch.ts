export async function prefetchAll(...tasks: ReadonlyArray<Promise<unknown>>): Promise<void> {
  await Promise.all(tasks.map((task) => task.catch(() => null)));
}