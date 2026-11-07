import type { WorkspacesReader } from '../storage/contracts.ts';
import type { Id, Workspace } from '../storage/domain.ts';
import { forbidden } from '../lib/errors.ts';

const NO_WORKSPACE_ACCESS = 'User does not have access to this resource.';

/** The one refusal for a workspace the caller may not use; a missing workspace looks the same. */
export const noWorkspaceAccess = () => forbidden(NO_WORKSPACE_ACCESS);

/** The workspace when `userId` is a member of it; 403 otherwise. A stored default is no exception. */
export async function memberWorkspace(
  ctx: { workspaces: Pick<WorkspacesReader, 'forMember'> },
  userId: Id,
  workspaceId: Id,
): Promise<Workspace> {
  const workspace = await ctx.workspaces.forMember(userId, workspaceId);
  if (!workspace) throw noWorkspaceAccess();
  return workspace;
}
