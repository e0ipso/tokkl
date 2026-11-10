import type { WorkspacesRepository } from './ports.ts';
import type { Id, Workspace } from './model.ts';
import { forbidden } from '../lib/errors.ts';

const NO_WORKSPACE_ACCESS = 'User does not have access to this resource.';
const NOT_WORKSPACE_OWNER = 'Only the workspace owner can change its settings.';

/** A missing workspace looks the same. */
export const noWorkspaceAccess = () => forbidden(NO_WORKSPACE_ACCESS);

/** A stored default is no exception. */
export async function memberWorkspace(
  ctx: { workspaces: Pick<WorkspacesRepository, 'forMember'> },
  userId: Id,
  workspaceId: Id,
): Promise<Workspace> {
  const workspace = await ctx.workspaces.forMember(userId, workspaceId);
  if (!workspace) throw noWorkspaceAccess();
  return workspace;
}

/** A member gets its own 403; anyone else the usual one. */
export async function ownedWorkspace(
  ctx: { workspaces: Pick<WorkspacesRepository, 'forMember' | 'getRole'> },
  userId: Id,
  workspaceId: Id,
): Promise<Workspace> {
  const workspace = await memberWorkspace(ctx, userId, workspaceId);
  if ((await ctx.workspaces.getRole(userId, workspaceId)) !== 'owner') throw forbidden(NOT_WORKSPACE_OWNER);
  return workspace;
}
