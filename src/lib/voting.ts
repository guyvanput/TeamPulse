export const VOTE_BUDGET = 3;

export function rankTopics(topics: readonly { id: string; createdAt: Date; count: number }[]) {
  return [...topics].sort((a, b) => b.count - a.count ||
    a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((topic, index) => ({ topicId: topic.id, position: index + 1, count: topic.count }));
}
