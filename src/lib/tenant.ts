import { auth } from "@/auth";
import { db } from "@/lib/db";

export type OrgRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER";

export type TenantContext = {
  orgId: string;
  userId: string;
  role: OrgRole;
};

export class TenantAccessError extends Error {
  constructor(message = "You do not have access to this organization") {
    super(message);
    this.name = "TenantAccessError";
  }
}

export async function requireTenant(): Promise<TenantContext> {
  const session = await auth();
  const userId = session?.user?.id;
  const orgId = session?.selectedOrgId;

  if (!userId || !orgId) {
    throw new TenantAccessError("Select an organization to continue");
  }

  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId, userId } },
    select: { role: true },
  });

  if (!membership) throw new TenantAccessError();
  return { orgId, userId, role: membership.role as OrgRole };
}

export async function requireTenantRole(
  allowedRoles: readonly OrgRole[],
): Promise<TenantContext> {
  const tenant = await requireTenant();
  if (!allowedRoles.includes(tenant.role)) {
    throw new TenantAccessError("Your organization role does not allow this action");
  }
  return tenant;
}

/** Adds the mandatory organization filter to a domain query. */
export function tenantWhere<T extends object>(tenant: TenantContext, where?: T): T & { orgId: string } {
  return { ...where, orgId: tenant.orgId } as T & { orgId: string };
}

/** Adds the mandatory organization owner to new domain records. */
export function tenantData<T extends object>(
  tenant: TenantContext,
  data: T,
): T & { orgId: string } {
  return { ...data, orgId: tenant.orgId };
}

export function assertDifficulty(difficulty: number): number {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    throw new RangeError("Question difficulty must be an integer from 1 to 5");
  }
  return difficulty;
}
