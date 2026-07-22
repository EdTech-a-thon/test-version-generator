import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

const registrationSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(8).max(128),
  organizationName: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  const parsed = registrationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid registration details" }, { status: 400 });
  }

  const { name, email, password, organizationName } = parsed.data;
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const slugBase =
    organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "organization";
  const slug = `${slugBase}-${randomUUID().slice(0, 8)}`;

  try {
    const user = await db.$transaction(async (tx) => {
      const org = await tx.org.create({
        data: { name: organizationName, slug },
      });
      return tx.user.create({
        data: {
          name,
          email,
          passwordHash,
          memberships: {
            create: { orgId: org.id, role: "OWNER" },
          },
        },
        select: { id: true, email: true },
      });
    });
    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    // A concurrent request may have registered the same email after our first check.
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "An account already exists for this email" }, { status: 409 });
    }
    throw error;
  }
}
