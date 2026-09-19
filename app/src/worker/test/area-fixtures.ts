export const workerAreaIds = {
  aiIt: 1,
  develop: 2,
  music: 3,
  inbox: 9,
} as const;

export const ownerAreaFixtures = [
  { id: workerAreaIds.aiIt, name: "AI/IT", color: "blue", position: 1 },
  {
    id: workerAreaIds.develop,
    name: "Develop",
    color: "purple",
    position: 2,
  },
  { id: workerAreaIds.music, name: "Music", color: "green", position: 3 },
] as const;
