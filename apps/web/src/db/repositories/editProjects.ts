import { db, type EditProject } from "../dexie";

export async function getEditProject(recordingId: string): Promise<EditProject | undefined> {
  return db().editProjects.get(recordingId);
}

export async function saveEditProject(p: EditProject): Promise<void> {
  await db().editProjects.put({ ...p, updatedAt: Date.now() });
}

export async function deleteEditProject(recordingId: string): Promise<void> {
  await db().editProjects.delete(recordingId);
}
